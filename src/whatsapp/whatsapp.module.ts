import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Message, MessageSchema } from './schemas/message.schema';
import { Channel, ChannelSchema } from './schemas/channel.schema';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { MetaModule } from 'src/meta/meta.module';

@Module({
  imports: [
    MetaModule,
    MongooseModule.forFeature([
      { name: Channel.name, schema: ChannelSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
  ],
  exports: [MongooseModule],
  providers: [WhatsappService],
  controllers: [WhatsappController], // Lo exportamos para que el Webhook pueda guardar mensajes
})
export class WhatsappModule {}
