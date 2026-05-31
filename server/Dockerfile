FROM node:18-alpine

WORKDIR /app

# server はルートの package.json を使用し、shared types に依存している
COPY package.json yarn.lock ./
COPY types/package.json types/yarn.lock ./types/

# 依存関係のインストール
RUN yarn install && \
    cd types && yarn install

# 全体をコピー（context がルートであることを想定）
COPY . .

# Colyseus サーバーのポート
EXPOSE 2567

CMD ["yarn", "start"]
