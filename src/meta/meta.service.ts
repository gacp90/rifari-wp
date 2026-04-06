import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class MetaService {
  private readonly logger = new Logger(MetaService.name);
  private readonly baseUrl = 'https://graph.facebook.com/v22.0';

  constructor(private configService: ConfigService) {}

  /* ================= SEND MESSAGE ================= */
  async sendMessage(phoneId: string, to: string, message: string) {
    // El Token de Usuario del Sistema (System User Token) sigue siendo el tuyo como Partner
    const token = this.configService.get<string>('META_MASTER_TOKEN');
    const url = `${this.baseUrl}/${phoneId}/messages`;

    try {
      const response = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to,
          type: 'text',
          text: { body: message },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(`Error enviando mensaje desde ${phoneId}`, error.response?.data || error.message);
      throw error;
    }
  }

  /* ================= CONFIRM READ ================= */
  async markAsRead(phoneId: string, wamid: string) {
    const token = this.configService.get<string>('META_MASTER_TOKEN'); // Tu nombre de variable corregido
    const url = `${this.baseUrl}/${phoneId}/messages`;

    try {
      await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: wamid,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      return true;
    } catch (error: any) {
      this.logger.error(`Error marcando como leído el mensaje ${wamid}`, error.response?.data || error.message);
      return false;
    }
  }

  /* ================ DESCARGA URL MEDIA =============== */
  // Obtener el URL del archivo desde Meta usando el media_id que viene en el mensaje
  async getMediaUrl(mediaId: string): Promise<string> {
    const token = this.configService.get<string>('META_MASTER_TOKEN');
    const url = `https://graph.facebook.com/v21.0/${mediaId}`;

    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    return response.data.url; // Esta URL expira en pocos minutos
  }

  /* ================= DOWNLOAD ARCHIVE BINARY OF META ================= */
  async downloadMedia(url: string, fileName: string): Promise<string> {
    const token = this.configService.get<string>('META_MASTER_TOKEN');
    
    // Definimos la ruta local donde se guardará (por ahora una carpeta /uploads)
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

    const filePath = path.join(uploadDir, fileName);
    const writer = fs.createWriteStream(filePath);

    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      headers: { Authorization: `Bearer ${token}` },
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(fileName));
      writer.on('error', reject);
    });
  }

  async registerTemplate(wabaId: string, templateData: any) {
    // Tomamos el token de tu archivo de entorno (.env)
    const token = this.configService.get<string>('META_MASTER_TOKEN');
    
    // Endpoint específico para CREAR plantillas en la cuenta de WhatsApp Business
    const url = `${this.baseUrl}/${wabaId}/message_templates`;

    /* El objeto templateData debe venir del frontend con esta estructura básica:
      {
        "name": "promo_rifa_abril",
        "language": "es",
        "category": "MARKETING",
        "components": [ ... ] 
      }
    */

    try {
      const response = await axios.post(url, templateData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      // Meta devuelve el ID de la plantilla creada y el estado (generalmente 'PENDING')
      return response.data;

    } catch (error) {
      this.logger.error(
        'Error creando plantilla en Meta:', 
        error.response?.data || error.message
      );
      
      // Extraemos el mensaje de error exacto de Meta para que el frontend sepa qué falló
      // (ej. "El nombre de la plantilla ya existe" o "Formato inválido")
      const metaErrorMessage = error.response?.data?.error?.message || 'Error desconocido al crear la plantilla en Meta';
      
      throw new BadRequestException(`Fallo en Meta: ${metaErrorMessage}`);
    }
  }

  /* ================= LOAD TEMPLATES ================= */
  async getTemplates(wabaId: string) {
    const token = this.configService.get<string>('META_MASTER_TOKEN');
    const url = `${this.baseUrl}/${wabaId}/message_templates`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
        
    return response.data.data; // Retorna array de plantillas
  }

  /* ================= SEND TEMPLATE ================= */
  async sendTemplate(
      phoneId: string, 
      to: string, 
      templateName: string, 
      langCode: string,
      bodyVariables?: string[], 
      mediaUrl?: string,
      mediaType?: 'image' | 'video' | 'document',
      buttons?: any[] // <-- NUEVO: Array para los botones dinámicos
    ) {
      const token = this.configService.get<string>('META_MASTER_TOKEN');
      const url = `${this.baseUrl}/${phoneId}/messages`;
      
      const templatePayload: any = {
        name: templateName,
        language: { code: langCode },
        components: []
      };

      // 1. HEADER (Multimedia)
      if (mediaUrl && mediaType) {
        templatePayload.components.push({
          type: 'header',
          parameters: [{ type: mediaType, [mediaType]: { link: mediaUrl } }]
        });
      }

      // 2. BODY (Variables dinámicas de texto)
      if (bodyVariables && bodyVariables.length > 0) {
        templatePayload.components.push({
          type: 'body',
          parameters: bodyVariables.map(variable => ({
            type: 'text',
            text: String(variable)
          }))
        });
      }

      // 3. BUTTONS (Respuestas rápidas con Payload o URLs dinámicas)
      if (buttons && buttons.length > 0) {
        buttons.forEach(button => {
          templatePayload.components.push({
            type: 'button',
            sub_type: button.sub_type, // 'quick_reply' o 'url'
            index: String(button.index), // La posición del botón: '0', '1', '2'
            parameters: [
              button.sub_type === 'quick_reply'
                ? { type: 'payload', payload: button.payload } // El dato oculto que te llegará al Webhook
                : { type: 'text', text: button.text }          // El pedazo de URL dinámica
            ]
          });
        });
      }

      const data = {
        messaging_product: "whatsapp",
        to: to,
        type: "template",
        template: templatePayload
      };

      try {
        const response = await axios.post(url, data, {
          headers: { Authorization: `Bearer ${token}` }
        });
        return response.data;
      } catch (error) {
        this.logger.error('Error enviando plantilla con botones', error.response?.data || error.message);
        throw error;
      }
  }

}