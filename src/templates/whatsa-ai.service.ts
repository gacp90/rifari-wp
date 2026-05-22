import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { GoogleGenAI, Type } from '@google/genai';
import { promises as fsPromises } from 'fs';
import * as fs from 'fs';

@Injectable()
export class WhatsappAiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  async auditarPlantilla(textPrompt: string, file?: Express.Multer.File) {
    try {
      const contents: any[] = [];

      // 1. Procesar el archivo si el cliente subió una imagen o video
      if (file) {
        if (file.mimetype.startsWith('video/')) {
          const uploadResult = await this.ai.files.upload({
            file: file.path,
            config: {
                mimeType: file.mimetype,
            }
          });
          contents.push(uploadResult);
        } else if (file.mimetype.startsWith('image/')) {
          const imageBuffer = fs.readFileSync(file.path);
          contents.push({
            inlineData: {
              data: imageBuffer.toString('base64'),
              mimeType: file.mimetype,
            },
          });
        }
      }

      // 2. Agregar el texto de la plantilla
      contents.push(`Texto a evaluar: "${textPrompt}"`);

      // 3. Consultar a Gemini forzando una respuesta en formato JSON
      const response: any = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents,
        config: {
          systemInstruction: `Eres un auditor automatizado para las Políticas de Comercio de Meta en WhatsApp.
            Tu objetivo es detectar EXCLUSIVAMENTE violaciones explícitas de juegos de azar.

            REGLAS DE RECHAZO ESTRICTO:
            Rechaza inmediatamente si detectas palabras literales como: "rifa", "sorteo", "lotería", "apuestas", "compra tu número", "tabla", "ganador", "premio en efectivo", "triples", o uso de emojis para camuflar dinero (manzanas verdes 🍏, lechugas 🥬, billetes 💵).

            REGLAS DE EXCEPCIÓN (LO QUE DEBES APROBAR):
            Permite y APRUEBA el uso de "fachadas corporativas". Expresiones como "Proyecto", "Edición Especial", "Beneficios", "Recompensas", "Inversión", "Apoyo", y llamados a la acción como "Quiero participar" o "Más información" SON VÁLIDOS y permitidos. 
            IMPORTANTE: La palabra "bendiciones" y el emoji ✨ son términos espirituales/emocionales válidos. NO los asumas como dinero ni juegos de azar. Si el texto usa "bendiciones" sin mencionar rifas explícitas, DEBES APROBARLO.

            SI RECHAZAS EL TEXTO:
            Genera entre 1 y 3 plantillas alternativas seguras que mantengan la intención del usuario pero disfrazadas como un programa de recompensas, un beneficio corporativo o un proyecto especial, eliminando cualquier rastro de azar o apuestas.`,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              aprobado: { type: Type.BOOLEAN },
              motivo_rechazo: { type: Type.STRING },
              sugerencia_correccion: { type: Type.STRING },
              plantillas_sugeridas: { 
                type: Type.ARRAY, 
                description: "Lista de 1 a 3 opciones de plantillas corregidas y seguras.",
                items: { type: Type.STRING } 
              },
            },
            required: ['aprobado', 'motivo_rechazo', 'sugerencia_correccion', 'plantillas_sugeridas'],
          },
        },
      });

      // 4. Limpieza del servidor (Vital para tu VPS de 2GB RAM)
      if (file && fs.existsSync(file.path)) {
        await fsPromises.unlink(file.path);
      }

      return JSON.parse(response.text);

    } catch (error) {
      console.error('Error con Gemini:', error);
      if (file && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      throw new InternalServerErrorException('Error al auditar la plantilla');
    }
  }
}