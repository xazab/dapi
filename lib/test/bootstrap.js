const path = require('path');
const dotenvSafe = require('dotenv-safe');
const dotenvExpand = require('dotenv-expand');
const { expect, use } = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const dirtyChai = require('dirty-chai');
const chaiAsPromised = require('chai-as-promised');

const DriveAbciOptions = require('@xazab/dp-services-ctl/lib/services/drive/abci/DriveAbciOptions');
const DapiCoreOptions = require('@xazab/dp-services-ctl/lib/services/dapi/core/DapiCoreOptions');
const DapiTxFilterStreamOptions = require('@xazab/dp-services-ctl/lib/services/dapi/txFilterStream/DapiTxFilterStreamOptions');
const XazabCoreOptions = require('@xazab/dp-services-ctl/lib/services/xazabCore/XazabCoreOptions');
const InsightApiOptions = require('@xazab/dp-services-ctl/lib/services/insightApi/InsightApiOptions');

use(sinonChai);
use(chaiAsPromised);
use(dirtyChai);

process.env.NODE_ENV = 'test';

const dotenvConfig = dotenvSafe.config({
  path: path.resolve(__dirname, '..', '..', '.env'),
});
dotenvExpand(dotenvConfig);

const rootPath = process.cwd();

const dapiContainerOptions = {
  volumes: [
    `${rootPath}/lib:/usr/src/app/lib`,
    `${rootPath}/scripts:/usr/src/app/scripts`,
  ],
};

const dapiOptions = {
  cacheNodeModules: true,
  localAppPath: rootPath,
  container: dapiContainerOptions,
};

if (process.env.SERVICE_IMAGE_DAPI) {
  dapiOptions.container = {
    image: process.env.SERVICE_IMAGE_DAPI,
    ...dapiContainerOptions,
  };
}

DapiCoreOptions.setDefaultCustomOptions(dapiOptions);
DapiTxFilterStreamOptions.setDefaultCustomOptions(dapiOptions);

if (process.env.SERVICE_IMAGE_DRIVE) {
  DriveAbciOptions.setDefaultCustomOptions({
    container: {
      image: process.env.SERVICE_IMAGE_DRIVE,
      envs: [
        'IDENTITY_ENABLE_ASSET_LOCK_TX_ONE_BLOCK_CONFIRMATION_FALLBACK=true',
      ],
    },
  });
}

if (process.env.SERVICE_IMAGE_CORE) {
  XazabCoreOptions.setDefaultCustomOptions({
    container: {
      image: process.env.SERVICE_IMAGE_CORE,
    },
  });
}

if (process.env.SERVICE_IMAGE_INSIGHT) {
  InsightApiOptions.setDefaultCustomOptions({
    container: {
      image: process.env.SERVICE_IMAGE_INSIGHT,
    },
  });
}

beforeEach(function beforeEach() {
  if (!this.sinon) {
    this.sinon = sinon.createSandbox();
  } else {
    this.sinon.restore();
  }
});

afterEach(function afterEach() {
  this.sinon.restore();
});

global.expect = expect;
