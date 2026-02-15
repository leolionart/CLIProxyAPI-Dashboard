# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Build with unique placeholders that will be replaced at runtime
ENV SUPABASE_URL=__SUPABASE_URL_PLACEHOLDER__
ENV SUPABASE_PUBLISHABLE_KEY=__SUPABASE_KEY_PLACEHOLDER__

RUN npm run build

# Production stage
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/00-inject-env.sh
RUN chmod +x /docker-entrypoint.d/00-inject-env.sh
EXPOSE 80

