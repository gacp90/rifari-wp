import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Channel, ChannelDocument } from './schemas/channel.schema';

@Injectable()
export class WhatsappService {
  constructor(
    @InjectModel(Channel.name) private channelModel: Model<ChannelDocument>
  ) {}

  async createChannel(channelData: any) {
    const newChannel = new this.channelModel(channelData);
    return await newChannel.save();
  }
}