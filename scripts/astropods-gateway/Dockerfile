FROM node:22.23.3-alpine
WORKDIR /app
COPY agent ./agent
USER node
CMD ["node", "agent/keepalive.mjs"]
