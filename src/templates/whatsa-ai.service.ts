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

      let intentos = 3;
      let tiempoEspera = 2000; // Empezamos esperando 2 segundos
      let response: any;

      while (intentos > 0) {
        try {
          response = await this.ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: {
            systemInstruction: `Eres un auditor automatizado y MULTIMODAL para las Políticas de Comercio de Meta.
              Tu objetivo es detectar violaciones explícitas de juegos de azar, TANTO EN EL TEXTO COMO EN CUALQUIER IMAGEN O VIDEO ADJUNTO.

              INSTRUCCIÓN DE VISIÓN (OCR) OBLIGATORIA:
              Si el usuario envía una imagen o video, DEBES leer detenidamente todo el texto escrito dentro. Si contiene palabras prohibidas o muestra premios en efectivo, DEBES RECHAZAR TODO EL ENVÍO INMEDIATAMENTE, sin importar qué tan inofensivo sea el texto principal.

              REGLAS DE RECHAZO ESTRICTO (APLICA PARA TEXTO, IMÁGENES Y VIDEOS):
              Rechaza de inmediato si detectas: "rifa", "sorteo", "lotería", "apuesta", "compra tu número", "tabla", "ganador", "premio en efectivo", "triples", "valor de la entrada", "a repartir", o el uso de emojis para camuflar dinero (🍏, 🥬, 💵).

              REGLA SOBRE VARIABLES DINÁMICAS DE WHATSAPP (MUY IMPORTANTE):
              El texto a evaluar contendrá variables encerradas en dobles llaves, por ejemplo: {{name}}, {{number}}, {{proyecto}}, {{1}}, etc.
              1. Estas son etiquetas del sistema para insertar datos de clientes. NO son palabras literales del mensaje.
              2. La etiqueta {{number}} se refiere a un dato de contacto, código o valor dinámico neutro. NUNCA la interpretes como "número de lotería", "número de rifa" o juego de azar.
              3. DEBES APROBAR mensajes neutros o inofensivos que usen estas variables (Ej. "Hoy iniciamos {{number}}" o "Hola {{name}}"). Solo rechaza si las palabras reales que RODEAN a la variable violan explícitamente las reglas.

              REGLAS DE EXCEPCIÓN (LO QUE DEBES APROBAR):
              Permite y APRUEBA "fachadas corporativas" en el texto principal (Ej. "rifari", "Iniciativa", "Proyecto", "Edición Especial", "Beneficios", "Quiero participar").
              La palabra "bendiciones" y el emoji ✨ son términos espirituales/emocionales permitidos.
              OJO: Estas excepciones SOLO aplican si la imagen adjunta también es corporativa y limpia. Si la imagen muestra una lotería evidente, la excepción se anula.
              La palabra "ticket", "tickets" o el emoji 🎫 ESTÁN PERMITIDOS ÚNICAMENTE si el mensaje tiene un tono estrictamente administrativo, de cobranza o actualización de reservas (Ej. "abono a tu cuenta", "estado de tu reserva"). Sin embargo, DEBES RECHAZARLA si en el mismo mensaje se mencionan premios, vehículos, ganar, o sorteos.

              SI RECHAZAS EL TEXTO O LA IMAGEN:
              Asume el rol de un experto en neuromarketing y copywriting persuasivo para WhatsApp. Genera entre 3 y 5 plantillas de texto alternativas que sean 100% seguras ante Meta. 
              ES VITAL QUE DES VARIEDAD DE TAMAÑOS: Incluye al menos dos opciones que sean extremadamente cortas, directas y simples (para envíos rápidos), y dos opciones más desarrolladas con técnicas de ventas.

              REGLAS ESTRICTAS PARA TUS SUGERENCIAS:
              1. Variedad de longitud: La opción 1 y 2 deben ser muy breves, directas y al grano, manteniendo la estructura corta original del usuario pero limpiando las palabras prohibidas (Ej. Cambiar "tu reservado es {{number}}" por "tu código de acceso es {{number}}").
              2. Usa ganchos psicológicos (Para las opciones largas): Inicia con preguntas o escenarios que activen la imaginación (Ej. "¿Qué harías si...").
              3. Tono cercano y de intriga: Escribe de forma natural y emocionante. NUNCA uses un tono robótico, aburrido o excesivamente corporativo.
              4. Sustitución inteligente: Cambia palabras de azar o emojis de dinero (🥦, 🥬, 💵) por conceptos de valor neutros (ej: "beneficios", "sorpresa", 🎁, 🌟) y cambia "ticket/reservado" por "código", "acceso" o "registro".
              5. El Gancho para abrir la ventana de 24h: NUNCA sugieras mencionar la palabra "premios", "sorteos" ni detalles de montos o regalos. Usa el principio de "curiosidad extrema" para obligar al usuario a responder. SIEMPRE cierra con un Llamado a la Acción (CTA) rápido: "Responde 'QUIERO VER' para los detalles", o "¿Te muestro de qué se trata?".
              
              MAPEO DE INTENCIONES (CÓMO TRADUCIR EL MENSAJE DEL USUARIO):
              Analiza qué intenta comunicar el usuario y genera sugerencias basadas en estos 4 escenarios exactos:

              1. Promoción de Rifa/Sorteo Nuevo: 
              Si intentan vender números, transfórmalo en un "Lanzamiento de Proyecto" o "Fase de Inscripción". 
              El CTA (Gancho): "Responde 'INFO' para enviarte el catálogo de beneficios."

              2. Recordatorio de Pago/Abono: 
              Si piden dinero, transfórmalo en un mensaje 100% administrativo sobre "Estado de Cuenta" o "Actualización de Reserva".
              El CTA (Gancho): "Responde 'PAGADO' si ya lo hiciste, o 'AYUDA' si necesitas más tiempo."

              3. Anuncio de Premio Especial (Carros, $200, etc.): 
              Si mencionan dinero o premios específicos, ESTÁ PROHIBIDO REPETIRLO en las sugerencias. Transfórmalo en "Una sorpresa desbloqueada", "Un bono especial para miembros activos" o "Un beneficio oculto". 
              El CTA (Gancho): "Hay algo increíble esperando por ti. Responde 'QUIERO VER' para mostrarte de qué se trata."

              4. Ultimátum / Liberación de Número: 
              Si amenazan con quitar el número por falta de pago, transfórmalo en una "Verificación de Reserva". 
              El CTA (Gancho): "Tu lugar está a punto de expirar. Responde 'CONFIRMAR' ahora mismo para mantener tu reserva activa, de lo contrario será reasignado."
              
              `,
                
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
          
          // Si la petición fue exitosa, rompemos el ciclo while y continuamos
          break; 

        } catch (apiError: any) {
          // Detectamos si es un error 503 (Saturación) o 429 (Límite de tasa)
          if ((apiError.status === 503 || apiError.status === 429) && intentos > 1) {
            intentos--;
            console.warn(`[Rifari AI] Servidores de Google ocupados. Reintentando en ${tiempoEspera/1000}s...`);
            // Pausamos la ejecución
            await new Promise((resolve) => setTimeout(resolve, tiempoEspera));
            tiempoEspera *= 2; // El próximo intento esperará 4 segundos (Exponencial)
          } else {
            // Si es un error distinto o se agotaron los intentos, reventamos el error para que caiga en tu catch principal
            throw apiError;
          }
        }
      }

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
      throw new InternalServerErrorException({ok: false, msg: 'Error al auditar la plantilla'});
    }
  }
}