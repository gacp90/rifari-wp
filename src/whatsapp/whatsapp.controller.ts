import { Controller, Post, Body, Headers, UnauthorizedException, Get } from '@nestjs/common';
import { MetaService } from '../meta/meta.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WhatsappService } from './whatsapp.service';

import { Channel, ChannelDocument } from './schemas/channel.schema';
import { Message, MessageDocument } from './schemas/message.schema';

@Controller('api/whatsapp')
export class WhatsappController {
    constructor(
        private readonly whatsappService: WhatsappService,
        private readonly metaService: MetaService, // Inyectamos el servicio de Meta
        @InjectModel(Channel.name) private channelModel: Model<ChannelDocument>,
        @InjectModel(Message.name) private messageModel: Model<MessageDocument>
    ) {}

    /* ============ POST CHANEL =================== */
    @Post('channel')
    async createChannel(@Body() body: any) {
        try {
            const channel = await this.whatsappService.createChannel(body);
            return { success: true, data: channel };
        } catch (error) {
            return { success: false, error: 'Error al crear el canal', details: error.message };
        }
    }

    /* ============ SEND MESSAGE =================== */
    @Post('send')
    async sendDynamicMessage(
        @Headers('x-api-key') apiKey: string,
        @Body() body: { to: string; message: string }
    ) {
        const channel = await this.channelModel.findOne({ internalApiKey: apiKey });

        if (!channel || !channel.isActive) {
            throw new UnauthorizedException('API Key inválida');
        }

        try {
            const result = await this.metaService.sendMessage(
                channel.phoneNumberId,
                body.to,
                body.message
            );

            // Guardamos el mensaje en nuestra base de datos
            const newMessage = new this.messageModel({
                channelId: channel._id,
                internalApiKey: channel.internalApiKey,
                wamid: result.messages[0].id,
                from: channel.displayPhoneNumber,
                to: body.to,
                direction: 'outbound',
                type: 'text',
                content: { text: body.message },
                status: 'sent',
            });

            await newMessage.save();

            return {
                success: true,
                data: newMessage,
                messageId: result.messages[0].id,
                sentFrom: channel.displayPhoneNumber
            };
        } catch (error: any) {
            const errorDetail = error.response?.data || error.message;
            return { success: false, error: 'Error al enviar', details: errorDetail };
        }
    }

    /* ============ CONFIRMACION DE LECTURA =================== */
    @Post('read-status')
    async markMessageAsRead(
        @Headers('x-api-key') apiKey: string,
        @Body() body: { wamid: string }
    ) {
        // 1. Validamos al cliente
        const channel = await this.channelModel.findOne({ internalApiKey: apiKey });
        if (!channel) throw new UnauthorizedException();

        // 2. Llamamos a Meta para poner el check azul
        const success = await this.metaService.markAsRead(
        channel.phoneNumberId,
            body.wamid
        );

        if (success) {
        // 3. Opcional: Actualizamos nuestra propia BD para saber que ya se leyó
        await this.messageModel.findOneAndUpdate(
            { wamid: body.wamid },
            { status: 'read' }
        );
        return { success: true };
        }

        return { success: false, message: 'No se pudo marcar como leído en Meta' };
    }

    /* ================= LOAD TEMPLATES ================= */
    @Get('templates')
    async getTemplates(@Headers('x-api-key') apiKey: string) {
        const channel = await this.channelModel.findOne({ internalApiKey: apiKey });
        if (!channel) throw new UnauthorizedException();

        // Llamamos a Meta para traer las plantillas
        return await this.metaService.getTemplates(channel.wabaId);
    }

    /* ================= SEND TEMPLATE ================= */

    @Post('send-template')
    async sendTemplate(
        @Headers('x-api-key') apiKey: string,
        @Body() body: {
            to: string; 
            templateName: string; 
            langCode?: string;
            bodyVariables?: string[];
            mediaUrl?: string; 
            mediaType?: 'image' | 'video' | 'document',
            buttons?: any[]
        }
        ) {
        const channel = await this.channelModel.findOne({ internalApiKey: apiKey });
        if (!channel) throw new UnauthorizedException();

        // Enviamos la plantilla
        const result = await this.metaService.sendTemplate(
            channel.phoneNumberId,
            body.to,
            body.templateName,
            body.langCode || 'en_US',
            body.bodyVariables || [],
            body.mediaUrl,
            body.mediaType,
            body.buttons            
        );

        // Guardamos el registro en Mongo
        const newMessage = new this.messageModel({
            internalApiKey: apiKey,
            channelId: channel._id,
            wamid: result.messages[0].id,
            from: channel.displayPhoneNumber,
            to: body.to,
            direction: 'outbound',
            type: 'template',
            content: {
            text: `Plantilla: ${body.templateName}`,
            mediaUrl: body.mediaUrl,
            mediaType: body.mediaType
            },
            status: 'sent'
        });

        await newMessage.save();
        return { success: true };
    }

    @Post('send-template-bulk')
    async sendTemplateBulk(
        @Headers('x-api-key') apiKey: string,
        @Body() body: { 
            templateName: string;
            // Ahora recibimos un objeto con el teléfono y sus variables personalizadas
            customers: Array<{ phone: string; parameters: string[] }>; 
        }
        ) {
        const channel = await this.channelModel.findOne({ internalApiKey: apiKey });
        if (!channel) throw new UnauthorizedException();

        // Devolvemos el OK al frontend inmediatamente
        const responseMsg = `Enviando ${body.customers.length} mensajes en segundo plano.`;
        
        // Ejecutamos el loop sin el 'await' para que el usuario no se quede esperando
        this.processBulkQueue(channel, body);

        return { success: true, message: responseMsg };
        }

        private async processBulkQueue(channel: any, body: any) {
        for (const customer of body.customers) {
            try {
            // Llamamos a Meta, pasándole los parámetros dinámicos de ESE cliente
            const result = await this.metaService.sendTemplate(
                channel.phoneNumberId,
                customer.phone,       
                body.templateName,    
                body.langCode || 'en_US',                 
                customer.parameters,  
                body.mediaUrl,        
                body.mediaType,       
                customer.buttons
            );

            // Guardamos en nuestra DB
            await this.messageModel.create({
                internalApiKey: channel.internalApiKey,
                channelId: channel._id,
                wamid: result.messages[0].id,
                from: channel.displayPhoneNumber,
                to: customer.phone,
                direction: 'outbound',
                type: 'template',
                content: { text: `Plantilla: ${body.templateName} enviada a ${customer.parameters[0]}` },
                status: 'sent'
            });

            // Pausa de 100ms para cuidar el Rate Limit de Meta y nuestra DB
            await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.log(error);                
            }
        }
    }
}