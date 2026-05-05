import { Module } from '@nestjs/common';
import { SpidiService } from './spidi.service';
import { SpidiController } from './spidi.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Channel } from 'diagnostics_channel';
import { ChannelSchema } from 'src/whatsapp/schemas/channel.schema';
import { Transaction, TransactionSchema } from './schema/transaction.schema';
import { ChatModule } from 'src/chat/chat.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: Channel.name, schema: ChannelSchema },
    ]),
    ChatModule
  ],
  controllers: [SpidiController],
  providers: [SpidiService],
})
export class SpidiModule {}
