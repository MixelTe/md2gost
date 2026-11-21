FROM node:24-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:npm \
    && npm run build:npm-readme \
    && cp README-NPM.md README.md \
    && mkdir /package \
    && npm pack --pack-destination /package

FROM node:24-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-writer libreoffice-math python3-uno \
        fonts-liberation2 fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /package/*.tgz /tmp/md2gost.tgz
RUN npm install --global --ignore-scripts /tmp/md2gost.tgz \
    && rm /tmp/md2gost.tgz \
    && npm cache clean --force
ENV LANG=C.UTF-8 \
    UNO_PYTHON_PATH=/usr/bin/python3
USER node
WORKDIR /data
ENTRYPOINT ["md2gost"]
