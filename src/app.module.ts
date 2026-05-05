import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MetaModule } from './meta/meta.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WebhookModule } from './webhook/webhook.module';
import { MongooseModule } from '@nestjs/mongoose';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { MediaController } from './media/media.controller';
import { MediaModule } from './media/media.module';
import { ChatModule } from './chat/chat.module';
import { TemplatesModule } from './templates/templates.module';
import { SpidiModule } from './spidi/spidi.module';

@Module({
  imports: [
    // Esto hace que el .env esté disponible en todo el proyecto
    ConfigModule.forRoot({ isGlobal: true }), 
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
    }),
    MetaModule, 
    WebhookModule, 
    WhatsappModule, 
    MediaModule, ChatModule, TemplatesModule, SpidiModule
  ],
  controllers: [AppController, MediaController],
  providers: [AppService],
})
export class AppModule {}
