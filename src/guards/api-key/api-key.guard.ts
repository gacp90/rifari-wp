import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Observable } from 'rxjs';
import { ChannelDocument } from 'src/whatsapp/schemas/channel.schema';

@Injectable()
export class ApiKeyGuard implements CanActivate {

  constructor(@InjectModel('Channel') private channelModel: Model<ChannelDocument>) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    // 1. Verificamos que el header exista
    if (!apiKey) {
      throw new UnauthorizedException({ ok: false, msg: 'No se proporcionó x-api-key en los headers' });
    }

    // 2. Verificamos que el API Key realmente exista en tu MongoDB
    const channel = await this.channelModel.findOne({ internalApiKey: apiKey });
    if (!channel) {
      throw new UnauthorizedException({ ok: false, msg: 'API Key inválida o canal no encontrado' });
    }

    // 3. ¡EL TRUCO MÁGICO! 
    // Guardamos el canal dentro del objeto request para que el controlador lo use sin volver a buscarlo en la BD
    request.channel = channel;

    return true; // Dejamos pasar la petición
  }
}
