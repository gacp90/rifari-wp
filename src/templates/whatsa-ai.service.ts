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
          // A) Subimos el video a los servidores de Google
          const uploadResult = await this.ai.files.upload({
            file: file.path,
            config: {
                mimeType: file.mimetype,
            }
          });

          // B) Bucle de espera: Asegurarnos de que Google terminó de procesar el video
          let fileInfo = await this.ai.files.get({ name: uploadResult.name! });
          while (fileInfo.state === 'PROCESSING') {
            // Pausamos la ejecución 2 segundos y volvemos a preguntar
            await new Promise((resolve) => setTimeout(resolve, 2000));
            fileInfo = await this.ai.files.get({ name: uploadResult.name! });
          }

          if (fileInfo.state === 'FAILED') {
            throw new Error('Los servidores de Google no pudieron procesar el video adjunto.');
          }

          // C) Estructura correcta (fileData) requerida por el SDK para archivos subidos
          contents.push({
            fileData: {
              fileUri: uploadResult.uri,
              mimeType: uploadResult.mimeType,
            },
          });
          
        }else if (file.mimetype.startsWith('image/')) {
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
            Permite y APRUEBA "fachadas corporativas" en el texto principal (Ej. "rifari", "Iniciativa", "Proyecto", "Edición Especial", "Beneficios", "Quiero participar").
            La palabra "bendiciones" y el emoji ✨ son términos espirituales/emocionales permitidos.
            OJO: Estas excepciones SOLO aplican si la imagen adjunta también es corporativa y limpia. Si la imagen muestra una lotería evidente, la excepción se anula y debes rechazar.

            SI RECHAZAS EL TEXTO O LA IMAGEN:
            Asume el rol de un experto en neuromarketing y copywriting persuasivo para WhatsApp. Genera entre 1 y 3 plantillas de texto alternativas que sean 100% seguras ante Meta, pero que le vendan a la mente y a la emoción del cliente.

            REGLAS ESTRICTAS PARA TUS SUGERENCIAS:
            1. Usa ganchos psicológicos: Inicia con preguntas o escenarios que activen la imaginación (Ej. "¿Qué harías si...", "Imagina por un segundo...", "Visualiza...").
            2. Tono cercano y de intriga: Escribe de forma natural, emocionante y conversacional. NUNCA uses un tono robótico, aburrido o excesivamente corporativo (prohibido usar frases como "programa de reconocimiento", "ceremonia", o "iniciativa corporativa").
            3. Sustitución inteligente: Cambia las palabras de azar (ticket, rifa, ganar) por conceptos aspiracionales (ej: "unirte al proyecto", "asegurar tu lugar", "la gran meta", "edición especial").
            4. Mantén la urgencia: Incluye llamados a la acción claros y fechas límite sin sonar desesperado.`,
            
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