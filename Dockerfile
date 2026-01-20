FROM node:20-alpine

WORKDIR /app

# Install PostgreSQL client for healthcheck
RUN apk add --no-cache postgresql-client

# Create package.json
RUN echo '{ \
  "name": "rnrsvp", \
  "version": "1.0.0", \
  "type": "module", \
  "scripts": { "start": "node server.js" }, \
  "dependencies": { \
    "express": "^4.18.2", \
    "pg": "^8.11.3", \
    "cors": "^2.8.5" \
  } \
}' > package.json

RUN npm install

# Copy application files
COPY server.js .
COPY public ./public

EXPOSE 3000

CMD ["npm", "start"]
