# Stage 1: Build the React static assets
FROM node:20-alpine AS builder
WORKDIR /app

# The original package.json does not have a package-lock.json, so we MUST use npm install
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: Serve using Nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
