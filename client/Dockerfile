FROM node:18-alpine

WORKDIR /app

# shared types と client の依存関係をコピーしてインストール
COPY package.json yarn.lock ./
COPY client/package.json client/yarn.lock ./client/
COPY types/package.json types/yarn.lock ./types/

# モノレポ構造のため、各ディレクトリでインストールを実行
RUN yarn install && \
    cd types && yarn install && \
    cd ../client && yarn install

# 全体をコピー（context がルートであることを想定）
COPY . .

WORKDIR /app/client

# Vite の開発サーバーを 3000 ポートで起動
EXPOSE 3000

CMD ["yarn", "dev", "--host", "0.0.0.0", "--port", "3000"]
