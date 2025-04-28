FROM node:20-alpine

WORKDIR /app

# Set default log level to "info" (can be overridden at runtime)
ENV LOG_LEVEL=info

COPY package*.json ./
RUN npm install --production

COPY src ./src

CMD ["npm", "start"]