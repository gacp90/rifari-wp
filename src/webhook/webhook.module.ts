import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { WebhookService } from './webhook.service';
import { MetaModule } from 'src/meta/meta.module';
import { ChatModule } from 'src/chat/chat.module';
import { MongooseModule } from '@nestjs/mongoose';
import { Template, TemplateSchema } from 'src/templates/schemas/template.schema';
import { Channel, ChannelSchema } from 'src/whatsapp/schemas/channel.schema';

@Module({
  controllers: [WebhookController],
  imports: [
    WhatsappModule, 
    MetaModule, 
    ChatModule,
    MongooseModule.forFeature([
      { name: Template.name, schema: TemplateSchema },
      { name: Channel.name, schema: ChannelSchema }
    ])
  ],
  providers: [WebhookService]
})
export class WebhookModule {}
