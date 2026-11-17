# Chat Service

This is the Chat Service for the IM-flutter application. It is built using the [NestJS](https://nestjs.com) framework and uses gRPC for communication with other microservices.

## Overview

The Chat Service handles real-time messaging functionalities. It exposes both an HTTP endpoint (for health checks, potentially for internal admin APIs) and a gRPC service defined in `protos/chat.proto`.

- **HTTP Port**: 3003
- **gRPC Port**: 50053

## Project setup

```bash
$ pnpm install
```

## Running the service

### Development

```bash
# Run in watch mode
$ pnpm run dev
# or
$ pnpm run start:dev
```

### Production

```bash
# Build the application
$ pnpm run build

# Run the built application
$ pnpm run start:prod
```

## Key Dependencies

- `@nestjs/microservices`: For building microservices.
- `@nestjs/mongoose`: For MongoDB object modeling.
- `@grpc/grpc-js` & `@grpc/proto-loader`: For gRPC communication.
- `mongoose`: MongoDB ODM.

## Service Interaction

This service communicates via gRPC. The protocol buffer definitions are located in the shared `protos` directory.

## License

This project is licensed under the MIT License.