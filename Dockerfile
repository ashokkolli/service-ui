# Only for technical/build aims, built image will be with nginxinc/nginx-unprivileged:alpine according to the last step


FROM alpine:3.20.3 AS generate-build-info
RUN mkdir -p /usr/src/app/build
WORKDIR /usr/src
ARG APP_VERSION=develop
ARG BUILD_BRANCH
ARG BUILD_DATE
RUN echo {\"build\": { \"version\": \"${APP_VERSION}\", \"branch\": \"${BUILD_BRANCH}\", \"build_date\": \"${BUILD_DATE}\", \"name\": \"Service UI\", \"repo\": \"reportportal/service-ui\"}} > ./app/build/buildInfo.json

FROM node:20-alpine AS build-frontend
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY ./app/ /usr/src/app/
# NODE_OPTIONS must be an ENV (a `RUN export` doesn't persist to the next RUN) so
# webpack actually gets the larger heap — the prior build OOM/SIGKILLed.
ENV NODE_OPTIONS="--max-old-space-size=6144"
RUN npm ci --legacy-peer-deps && npm run build

FROM nginxinc/nginx-unprivileged:alpine

USER root

COPY --from=build-frontend /usr/src/app/build /usr/share/nginx/html
COPY --from=generate-build-info /usr/src/app/build /usr/share/nginx/html

# FASTBREAK runtime overlay. brand.js sets window.FASTBREAK_API_URL (the
# Observability tab's live-KPIs backend), favicon and title; brand-auth.js is the
# credential-free login-page branding. These lived only INSIDE the fb35 image
# before (injected post-build, never committed) — a rebuild silently dropped them
# and the tab honestly fell back to tagged sample data. Baked into the build now
# so every image is reproducible from the repo.
COPY brand.js brand-auth.js /usr/share/nginx/html/
RUN sed -i 's#</head>#<script src="brand-auth.js"></script><script defer src="brand.js"></script></head>#' /usr/share/nginx/html/index.html

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/nginx.conf

USER $UID

EXPOSE 8080
