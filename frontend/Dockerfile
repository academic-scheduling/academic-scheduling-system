# Frontend yayin imaji: derle, sonra statik olarak servis et.
#
# Iki asama var cunku node ve npm YALNIZCA derleme icin gerekli. Tek asamali
# bir imaj, calisan konteynere 300 MB'lik node_modules ve bir Node calisma
# zamani tasirdi -- hicbiri istek karsilamak icin kullanilmayacakti. Derleme
# ciktisi (dist/) sadece statik dosya; onu servis etmek icin nginx yeterli.

FROM node:20-alpine AS derleme
WORKDIR /app

# Once yalniz manifest dosyalari: kaynak kod degistiginde bu katman
# onbellekten gelir ve npm ci bastan calismaz.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# VITE_API_BASE_URL BILEREK bos birakiliyor: bos oldugunda src/api/client.ts
# "/api" goreli yolunu kullanir, nginx de onu backend'e tasir. Yani tarayici
# icin tek bir adres var -- CORS diye bir sorun dogmuyor.
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=derleme /app/dist /usr/share/nginx/html
EXPOSE 80
