FROM ghcr.io/puppeteer/puppeteer:latest

ENV NODE_ENV=production
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 7872

CMD ["node", "linkedinscrap.js"]
