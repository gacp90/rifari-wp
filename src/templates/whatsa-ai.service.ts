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
          systemInstruction: `Eres un auditor automatizado y MULTIMODAL para las Políticas de Comercio de Meta.
            Tu objetivo es detectar violaciones explícitas de juegos de azar, TANTO EN EL TEXTO COMO EN CUALQUIER IMAGEN O VIDEO ADJUNTO.

            INSTRUCCIÓN DE VISIÓN (OCR) OBLIGATORIA:
            Si el usuario envía una imagen, DEBES leer detenidamente todo el texto escrito dentro de ella. Si el texto de la imagen contiene palabras prohibidas o muestra premios en efectivo, DEBES RECHAZAR TODO EL ENVÍO INMEDIATAMENTE, sin importar qué tan inofensivo sea el texto principal.

            REGLAS DE RECHAZO ESTRICTO (APLICA PARA TEXTO E IMÁGENES y VIDEOS):
            Rechaza de inmediato si en el texto o en la imagen o video detectas: "rifa", "sorteo", "lotería", "apuesta", "compra tu número", "tabla", "ganador", "premio en efectivo", "triples", "valor de la entrada", "a repartir", o el uso de emojis para camuflar dinero (🍏, 🥬, 💵).

            REGLAS DE EXCEPCIÓN (LO QUE DEBES APROBAR):
            Permite y APRUEBA "fachadas corporativas" en el texto principal (Ej. "Proyecto", "Edición Especial", "Beneficios", "Quiero participar").
            La palabra "bendiciones" y el emoji ✨ son términos espirituales/emocionales permitidos.
            OJO: Estas excepciones SOLO aplican si la imagen adjunta también es corporativa y limpia. Si la imagen muestra una lotería evidente, la excepción se anula y debes rechazar.

            SI RECHAZAS EL TEXTO O LA IMAGEN O EL VIDEO:
            Genera entre 1 y 3 plantillas de texto alternativas seguras que mantengan la intención del usuario pero disfrazadas una empresa de eventos o actividades como un programa de recompensas corporativo.`,
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