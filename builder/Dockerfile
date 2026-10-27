FROM oven/bun:latest AS bun
FROM node:slim AS node
FROM r-base:latest

ENV LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=Etc/UTC

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fontconfig \
        fonts-dejavu-core \
        fonts-glyphicons-halflings \
        fonts-mathjax \
        git \
        gnupg \
        r-cran-car \
        r-cran-knitr \
    && rm -rf /var/lib/apt/lists/*

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bunx /usr/local/bin/
COPY --from=node /usr/local/bin/node /usr/local/bin/node
