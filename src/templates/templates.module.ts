import { Module } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Template } from './entities/template.entity';
import { TemplateSchema } from './schemas/template.schema';
import { Channel, ChannelSchema } from 'src/whatsapp/schemas/channel.schema';
import { MetaModule } from 'src/meta/meta.module';
import { WhatsappAiService } from './whatsa-ai.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Template.name, schema: TemplateSchema },
      { name: Channel.name, schema: ChannelSchema }      
    ]),

    MetaModule
  ],
  controllers: [TemplatesController],
  providers: [TemplatesService, WhatsappAiService],
})
export class TemplatesModule {}
