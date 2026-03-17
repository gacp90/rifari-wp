import { 
  WebSocketGateway, 
  WebSocketServer, 
  OnGatewayConnection, 
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*', // O la URL de tu Angular
    methods: ['GET', 'POST'],
    allowedHeaders: ['x-api-key'],
    credentials: true
  }
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private logger = new Logger('ChatGateway');

  handleConnection(client: Socket) {
    // Intentamos obtener la internalApiKey desde auth o query
    const internalApiKey = client.handshake.auth?.['x-api-key'] || client.handshake.query['x-api-key'];

    if (internalApiKey) {
      client.join(internalApiKey); // El cuarto se llama como la internalApiKey
      this.logger.log(`🔌 Cliente autenticado: ${internalApiKey} | ID: ${client.id}`);
    } else {
      this.logger.warn(`⚠️ Conexión rechazada: No se proporcionó x-api-key`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`❌ Cliente desconectado: ${client.id}`);
  }

  // Angular llamará a esto para "entrar" a su canal privado
  @SubscribeMessage('join_channel')
  handleJoinChannel(
    @ConnectedSocket() client: Socket, 
    @MessageBody() internalApiKey: string
  ) {
    client.join(internalApiKey);
    this.logger.debug(`👤 Cuarto activado para internalApiKey: ${internalApiKey}`);
  }

  // Método que usaremos desde el WebhookService
  emitNewMessage(channelId: string, payload: any) {
    this.server.to(channelId).emit('new_message', payload);
  }
}