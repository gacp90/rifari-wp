import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { WebhookService } from './webhook.service';
import { MetaModule } from 'src/meta/meta.module';
import { ChatModule } from 'src/chat/chat.module';

@Module({
  controllers: [WebhookController],
  imports: [WhatsappModule, MetaModule, ChatModule],
  providers: [WebhookService]
})
export class WebhookModule {}
