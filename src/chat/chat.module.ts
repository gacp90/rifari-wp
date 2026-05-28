import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { MongooseModule } from '@nestjs/mongoose';
import { Message, MessageSchema } from 'src/whatsapp/schemas/message.schema';
import { Conversation, ConversationSchema } from './schemas/conversation.schema';
import { Channel, ChannelSchema } from 'src/whatsapp/schemas/channel.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Message.name, schema: MessageSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: Channel.name, schema: ChannelSchema },
    ])
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatGateway]
})
export class ChatModule {}
