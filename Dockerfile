FROM ghcr.io/puppeteer/puppeteer:latest

ENV NODE_ENV=production
WORKDIR /app

# Copy files as root and install dependencies
COPY package*.json ./
RUN chmod -R 755 .
RUN chmod 644 package-lock.json
RUN npm install

# Copy all other project files
COPY . .

# Create and set permissions for folders
RUN mkdir -p /app/uploads /app/.cache /tmp \
 && chown -R pptruser:pptruser /app

# Switch to non-root Puppeteer user
USER pptruser

EXPOSE 7872

# Start your server, not the scraper directly
CMD ["node", "main_js.js"]