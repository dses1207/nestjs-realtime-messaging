import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/chat',
})
export class WebSocketProxyGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebSocketProxyGateway.name);
  private clientConnections = new Map<string, ClientSocket>(); // socketId -> WebSocket Server connection

  constructor(private jwtService: JwtService) {}

  afterInit(server: Server) {
    this.logger.log('WebSocket Proxy Gateway initialized');
  }

  async handleConnection(client: Socket, ...args: any[]) {
    try {
      // 從 handshake 中取得 JWT token
      const token = client.handshake.auth?.token || 
                   client.handshake.headers?.authorization?.replace('Bearer ', '') ||
                   client.handshake.query?.token;
      
      if (!token) {
        this.logger.warn('Client connected without token');
        client.disconnect();
        return;
      }

      // 驗證 JWT token
      let payload: any;
      try {
        payload = this.jwtService.verify(token as string);
      } catch (error: any) {
        this.logger.warn('Invalid JWT token');
        client.disconnect();
        return;
      }

      const userId = payload.userId || payload.sub;
      if (!userId) {
        this.logger.warn('Invalid token payload - no userId');
        client.disconnect();
        return;
      }

      // 建立到真正 WebSocket Server 的連線
      const wsServerUrl = process.env.WEBSOCKET_SERVICE_URL || 'http://websocket-server:3004';
      // 確保 URL 格式正確
      const formattedUrl = wsServerUrl.startsWith('http') ? wsServerUrl : `http://${wsServerUrl}`;
      this.logger.log(`Connecting to WebSocket Server at: ${formattedUrl}/chat`);
      this.logger.log(`Environment WEBSOCKET_SERVICE_URL: ${process.env.WEBSOCKET_SERVICE_URL}`);
      
      const wsClient = ioClient(`${formattedUrl}/chat`, {
        extraHeaders: {
          'x-user-id': userId,
        },
      });

      // 儲存連線映射
      this.clientConnections.set(client.id, wsClient);

      // 設定雙向事件轉發
      this.setupEventForwarding(client, wsClient, userId);

      this.logger.log(`User ${userId} connected and proxied to WebSocket Server`);

    } catch (error: any) {
      this.logger.error('Error handling connection:', error.message);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const wsClient = this.clientConnections.get(client.id);
    if (wsClient) {
      wsClient.disconnect();
      this.clientConnections.delete(client.id);
      this.logger.log(`Client ${client.id} disconnected and proxy cleaned up`);
    }
  }

  private setupEventForwarding(frontendClient: Socket, wsClient: ClientSocket, userId: string) {
    // 轉發前端事件到 WebSocket Server
    frontendClient.onAny((eventName: string, ...args: any[]) => {
      if (eventName !== 'disconnect') {
        wsClient.emit(eventName, ...args);
      }
    });

    // 轉發 WebSocket Server 事件到前端（排除保留事件名稱）
    wsClient.onAny((eventName: string, ...args: any[]) => {
      if (!['connect', 'disconnect', 'connect_error', 'error'].includes(eventName)) {
        frontendClient.emit(eventName, ...args);
      }
    });

    // 處理 WebSocket Server 連線狀態
    wsClient.on('connect', () => {
      this.logger.log(`User ${userId} successfully connected to WebSocket Server`);
    });

    wsClient.on('disconnect', () => {
      this.logger.log(`User ${userId} disconnected from WebSocket Server`);
      frontendClient.disconnect();
    });

    wsClient.on('connect_error', (error: any) => {
      this.logger.error(`WebSocket Server connection error for user ${userId}:`, error);
      frontendClient.disconnect();
    });

    wsClient.on('error', (error: any) => {
      this.logger.error(`WebSocket Server error for user ${userId}:`, error);
      frontendClient.disconnect();
    });
  }
} 