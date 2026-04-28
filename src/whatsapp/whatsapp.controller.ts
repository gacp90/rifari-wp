import { Controller, Post, Body, Headers, UnauthorizedException, Get, HttpCode, BadRequestException, HttpStatus, ForbiddenException } from '@nestjs/common';
import { MetaService } from '../meta/meta.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WhatsappService } from './whatsapp.service';

import { Channel, ChannelDocument } from './schemas/channel.schema';
import { Message, MessageDocument } from './schemas/message.schema';
import { Template, TemplateDocument } from 'src/templates/schemas/template.schema';

@Controller('api/whatsapp')
export class WhatsappController {
    constructor(
        private readonly whatsappService: WhatsappService,
        private readonly metaService: MetaService, // Inyectamos el servicio de Meta
        @InjectModel(Channel.name) private channelModel: Model<ChannelDocument>,
        @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
        @InjectModel(Template.name) private templateModel: Model<TemplateDocument>,
    ) {}

    /* ============ POST CHANEL =================== */
    @Post('channel')
    async createChannel(@Body() body: any) {
        try {
            const channel = await this.whatsappService.createChannel(body);
            return { success: true, data: channel };
        } catch (error: any) {
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
                body.message,
                channel.access_token
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
            body.wamid,
            channel.access_token
        );

        if (success) {
            // 3. LA SOLUCIÓN: Buscar el mensaje para saber quién lo envió
            const mensajeReferencia = await this.messageModel.findOne({ wamid: body.wamid });

            if (mensajeReferencia) {
                // 4. Limpiar TODOS los mensajes recibidos de ese cliente
                await this.messageModel.updateMany(
                    { 
                        internalApiKey: apiKey,
                        from: mensajeReferencia.from, // El número del cliente
                        direction: 'inbound',
                        status: 'received' 
                    },
                    { 
                        $set: { status: 'read' } 
                    }
                );
            }
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
        return await this.metaService.getTemplates(channel.wabaId, channel.access_token);
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
            channel.access_token,
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
            customers: Array<{ phone: string; parameters: string[] }>; 
        }
    ) {
        // 1. Validar el canal
        const channel = await this.channelModel.findOne({ internalApiKey: apiKey });
        if (!channel) throw new UnauthorizedException('API Key inválida');

        if (!channel.isActive) {
            throw new ForbiddenException(`Tu cuenta no está activa para enviar campañas. Estado actual: ${channel.metaStatus}`);
        }

        const hoy = new Date();
        const ultimaFecha = channel.lastMessageDate || new Date(0);

        const esNuevoDia = hoy.toDateString() !== ultimaFecha.toDateString();

        const mensajesEnviadosHoy = esNuevoDia ? 0 : channel.dailyMessagesSent;
        const cantidadAEnviar = body.customers.length;

        // ¿Se pasa del límite de Meta?
        if ((mensajesEnviadosHoy + cantidadAEnviar) > channel.messagingLimit) {
            const disponibles = channel.messagingLimit - mensajesEnviadosHoy;
            throw new BadRequestException(
                `Límite de Meta excedido. Tu línea permite ${channel.messagingLimit} mensajes/día. Has enviado ${mensajesEnviadosHoy} hoy. Solo puedes enviar ${disponibles} mensajes más.`
            );
        }

        // 2. LA FUENTE DE LA VERDAD: Buscar la plantilla en TU base de datos
        // Asegúrate de buscarla por nombre y que pertenezca al WABA ID correcto
        const template = await this.templateModel.findOne({ 
            name: body.templateName,
            internalApiKey: channel.internalApiKey 
        });

        if (!template) {
            throw new BadRequestException(`La plantilla '${body.templateName}' no existe o no está sincronizada.`);
        }

        // 3. Determinar el costo según la categoría real de la base de datos
        // Usamos toUpperCase() por si en tu BD guardaste "marketing" en minúsculas
        const categoria = template.category.toUpperCase(); 
        const costoPorMensaje = categoria === 'MARKETING' ? 0.080 : 0.015;

        const totalCost = body.customers.length * costoPorMensaje;

        // 4. MAGIA ATÓMICA: Reserva de fondos
        const canalActualizado = await this.channelModel.findOneAndUpdate(
            { 
                _id: channel._id, 
                amount: { $gte: totalCost }, 
                isActive: true 
            },
            { 
                $inc: { amount: -totalCost },
                $set: {
                    dailyMessagesSent: mensajesEnviadosHoy + cantidadAEnviar,
                    lastMessageDate: hoy
                }
            },
            { new: true } 
        );

        if (!canalActualizado) {
            throw new BadRequestException(
                `Saldo insuficiente o cuenta inactiva. Necesitas ${totalCost} créditos para enviar a ${body.customers.length} contactos.`
            );
        }

        const responseMsg = `Campaña iniciada. Se han reservado ${totalCost} créditos (Categoría: ${categoria}).`;
        
        // 5. Ejecutamos el loop pasándole el costo calculado por el servidor
        this.processBulkQueue(canalActualizado, body, costoPorMensaje);

        return { success: true, message: responseMsg };
    }

    private async processBulkQueue(channel: any, body: any, costoPorMensaje: number) {
        let successCount = 0;
        let failCount = 0;

        for (const customer of body.customers) {
            try {
                // Llamamos a Meta
                const result = await this.metaService.sendTemplate(
                    channel.phoneNumberId,
                    customer.phone,       
                    body.templateName,    
                    body.langCode || 'en_US', 
                    channel.access_token, // Pasamos el API Key para que el servicio de Meta pueda cargar las variables desde la base de datos                
                    customer.parameters,  
                    body.mediaUrl || '',        
                    body.mediaType || '',       
                    customer.buttons
                );

                // Guardamos el registro histórico del mensaje (Esto sí debe ir uno a uno)
                await this.messageModel.create({
                    internalApiKey: channel.internalApiKey,
                    channelId: channel._id,
                    wamid: result.messages[0].id,
                    from: channel.displayPhoneNumber,
                    to: customer.phone,
                    direction: 'outbound',
                    type: 'template',
                    content: { text: `Plantilla: ${body.templateName} enviada` },
                    status: 'sent',
                    cost: costoPorMensaje
                });

                successCount++;

                // Pausa de 100ms para cuidar el Rate Limit de Meta (Aprox 10 mensajes por segundo)
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error: any) {
                failCount++;
                console.error(`Error enviando a ${customer.phone}. Incrementando contador de fallos.`);
                console.error('Detalle de Meta/Mongoose:', error.response?.data || error.message);              
            }
        }

        // EL REEMBOLSO: Se ejecuta solo una vez al final del bucle
        if (failCount > 0) {
            const refundAmount = failCount * costoPorMensaje;
            await this.channelModel.updateOne(
                { _id: channel._id },
                { $inc: { amount: refundAmount } }
            );
            
            console.log(`Campaña terminada. Fallaron ${failCount}. Reembolso aplicado: +${refundAmount} créditos.`);
        } else {
            console.log(`Campaña 100% exitosa. ${successCount} mensajes enviados.`);
        }
    }

    /* @Post('send-template-bulk')
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
    } */

    @Post('exchange-token')
    @HttpCode(HttpStatus.OK) // Devolvemos un 200 OK en lugar del 201 por defecto de los POST business_id
    async exchangeCode(
        @Body('code') code: string,
        @Body('wabaId') wabaId: string,
        @Body('phoneNumberId') phoneNumberId: string,
        @Body('business_id') business_id: string
    ) {
        
        // 1. Validación de seguridad básica
        if (!code) throw new BadRequestException('El código de autorización es obligatorio');
        if (!wabaId) throw new BadRequestException('El ID de la cuenta de WhatsApp es obligatorio');
        if (!phoneNumberId) throw new BadRequestException('El ID del número de teléfono es obligatorio');

        console.log('Controlador recibió el código desde Angular:', code);

        // 2. Llamamos al servicio para que vaya a la taquilla de Meta
        const metaResponse = await this.whatsappService.exchangeCodeForToken(code, wabaId, phoneNumberId, business_id);

        // 3. Devolvemos el resultado al frontend (Angular)
        return {
        success: true,
        message: 'WhatsApp vinculado correctamente',
        data: metaResponse 
        };
    }

    @Get('health')
    async getHealth(@Headers('x-api-key') apiKey: string) {
        if (!apiKey) throw new UnauthorizedException();
        return await this.whatsappService.getChannelHealth(apiKey);
    }
}