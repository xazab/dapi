FROM node:12-alpine

RUN apk update && \
    apk --no-cache upgrade && \
    apk add --no-cache git \
                       openssh-client \
                       python \
                       alpine-sdk \
                       zeromq-dev

# Install dependencies first, in a different location
# for easier app bind mounting for local development
WORKDIR /

COPY package.json package-lock.json ./
ENV npm_config_zmq_external=true
RUN npm ci --production

FROM node:12-alpine

# While we're using this image for tests
# We have to run `npm i` and zeromq build fails
RUN apk add zeromq-dev
RUN echo npm_config_zmq_external=true >> /etc/environment

LABEL maintainer="Xazab Developers <dev@xazab.xyz>"
LABEL description="DAPI Node.JS"

RUN apk update && apk add --no-cache zeromq-dev

# Copy NPM modules
COPY package.json package-lock.json ./
COPY --from=0 /node_modules/ /node_modules

ENV PATH /node_modules/.bin:$PATH

# Copy project files
WORKDIR /usr/src/app
COPY . ./

ARG NODE_ENV=production
ENV NODE_ENV ${NODE_ENV}

EXPOSE 2500 2501 2510
