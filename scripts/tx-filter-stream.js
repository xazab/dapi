const dotenv = require('dotenv');
const grpc = require('grpc');

const {
  client: {
    converters: {
      jsonToProtobufFactory,
      protobufToJsonFactory,
    },
  },
  server: {
    createServer,
    jsonToProtobufHandlerWrapper,
    error: {
      wrapInErrorHandlerFactory,
    },
  },
} = require('@xazab/grpc-common');

const {
  v0: {
    TransactionsWithProofsRequest,
    pbjs: {
      TransactionsWithProofsRequest: PBJSTransactionsWithProofsRequest,
      TransactionsWithProofsResponse: PBJSTransactionsWithProofsResponse,
    },
  },
  getCoreDefinition,
} = require('@xazab/dapi-grpc');

// Load config from .env
dotenv.config();

const config = require('../lib/config');
const { validateConfig } = require('../lib/config/validator');
const log = require('../lib/log');

const ZmqClient = require('../lib/externalApis/xazabcore/ZmqClient');
const xazabCoreRpcClient = require('../lib/externalApis/xazabcore/rpc');

const BloomFilterEmitterCollection = require('../lib/bloomFilter/emitter/BloomFilterEmitterCollection');

const testTransactionAgainstFilterCollectionFactory = require('../lib/transactionsFilter/testRawTransactionAgainstFilterCollectionFactory');
const emitBlockEventToFilterCollectionFactory = require('../lib/transactionsFilter/emitBlockEventToFilterCollectionFactory');
const testTransactionsAgainstFilter = require('../lib/transactionsFilter/testTransactionAgainstFilter');
const emitInstantLockToFilterCollectionFactory = require('../lib/transactionsFilter/emitInstantLockToFilterCollectionFactory');
const subscribeToTransactionsWithProofsHandlerFactory = require('../lib/grpcServer/handlers/tx-filter-stream/subscribeToTransactionsWithProofsHandlerFactory');

const subscribeToNewTransactions = require('../lib/transactionsFilter/subscribeToNewTransactions');
const getHistoricalTransactionsIteratorFactory = require('../lib/transactionsFilter/getHistoricalTransactionsIteratorFactory');

async function main() {
  // Validate config
  const configValidationResult = validateConfig(config);
  if (!configValidationResult.isValid) {
    configValidationResult.validationErrors.forEach(log.error);
    log.error('Aborting DAPI startup due to config validation errors');
    process.exit();
  }

  const isProductionEnvironment = process.env.NODE_ENV === 'production';

  // Subscribe to events from Xazab Core
  const xazabCoreZmqClient = new ZmqClient(config.xazabcore.zmq.host, config.xazabcore.zmq.port);

  // Bind logs on ZMQ connection events
  xazabCoreZmqClient.on(ZmqClient.events.DISCONNECTED, log.warn);
  xazabCoreZmqClient.on(ZmqClient.events.CONNECTION_DELAY, log.warn);
  xazabCoreZmqClient.on(ZmqClient.events.MONITOR_ERROR, log.warn);

  // Wait until zmq connection is established
  log.info(`Connecting to xazabcore ZMQ on ${xazabCoreZmqClient.connectionString}`);

  await xazabCoreZmqClient.start();

  log.info('Connection to ZMQ established.');

  // Add ZMQ event listeners
  const bloomFilterEmitterCollection = new BloomFilterEmitterCollection();
  const emitBlockEventToFilterCollection = emitBlockEventToFilterCollectionFactory(
    bloomFilterEmitterCollection,
  );
  const testRawTransactionAgainstFilterCollection = testTransactionAgainstFilterCollectionFactory(
    bloomFilterEmitterCollection,
  );
  const emitInstantLockToFilterCollection = emitInstantLockToFilterCollectionFactory(
    bloomFilterEmitterCollection,
  );

  // Send raw transactions via `subscribeToTransactionsWithProofs` stream if matched
  xazabCoreZmqClient.on(
    xazabCoreZmqClient.topics.rawtx,
    testRawTransactionAgainstFilterCollection,
  );

  // Send merkle blocks via `subscribeToTransactionsWithProofs` stream
  xazabCoreZmqClient.on(
    xazabCoreZmqClient.topics.rawblock,
    emitBlockEventToFilterCollection,
  );

  // TODO: check if we can receive this event before 'rawtx', and if we can,
  // we need to test tx in this message first before emitng lock to the bloom
  // filter collection
  // Send transaction instant locks via `subscribeToTransactionsWithProofs` stream
  xazabCoreZmqClient.on(
    xazabCoreZmqClient.topics.rawtxlocksig,
    emitInstantLockToFilterCollection,
  );

  // Start GRPC server
  log.info('Starting GRPC server');

  const wrapInErrorHandler = wrapInErrorHandlerFactory(log, isProductionEnvironment);

  const getHistoricalTransactionsIterator = getHistoricalTransactionsIteratorFactory(
    xazabCoreRpcClient,
  );

  const subscribeToTransactionsWithProofsHandler = subscribeToTransactionsWithProofsHandlerFactory(
    getHistoricalTransactionsIterator,
    subscribeToNewTransactions,
    bloomFilterEmitterCollection,
    testTransactionsAgainstFilter,
    xazabCoreRpcClient,
  );

  const wrappedSubscribeToTransactionsWithProofs = jsonToProtobufHandlerWrapper(
    jsonToProtobufFactory(
      TransactionsWithProofsRequest,
      PBJSTransactionsWithProofsRequest,
    ),
    protobufToJsonFactory(
      PBJSTransactionsWithProofsResponse,
    ),
    wrapInErrorHandler(subscribeToTransactionsWithProofsHandler),
  );

  const grpcServer = createServer(
    getCoreDefinition(0),
    {
      subscribeToTransactionsWithProofs: wrappedSubscribeToTransactionsWithProofs,
    },
  );

  grpcServer.bind(
    `0.0.0.0:${config.txFilterStream.grpcServer.port}`,
    grpc.ServerCredentials.createInsecure(),
  );

  grpcServer.start();

  log.info(`GRPC server is listening on port ${config.txFilterStream.grpcServer.port}`);

  // Display message that everything is ok
  log.info(`DAPI TxFilterStream process is up and running in ${config.livenet ? 'livenet' : 'testnet'} mode`);
  log.info(`Network is ${config.network}`);
}

main().catch((e) => {
  log.error(e.stack);
  process.exit();
});
