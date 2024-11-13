// processor.js

require('dotenv').config(); // Cargar variables de entorno desde .env

const express = require('express'); // Importar Express
const cors = require('cors'); // Importar middleware de CORS
const { PubSub } = require('@google-cloud/pubsub');
const { initializeSheets } = require('./shared/googleSheets'); // Ruta actualizada
const { config, initializeConfig } = require('./shared/config'); // Ruta actualizada
const appraisalStepsModule = require('./shared/appraisalSteps'); // Ruta actualizada
const cookieParser = require('cookie-parser'); // Importar cookie-parser si es necesario

const app = express(); // Crear una única instancia de Express

// **Configuración de CORS**
const corsOptions = {
  origin: 'https://appraisers-frontend-856401495068.us-central1.run.app',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // Si necesitas enviar cookies o credenciales
  optionsSuccessStatus: 200,
};

// **Aplicar el middleware de CORS antes de definir las rutas**
app.use(cors(corsOptions));

// **Manejar solicitudes OPTIONS preflight**
app.options('*', cors(corsOptions));

// Middleware de manejo de errores
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ success: false, message: 'Internal Server Error' });
});

// **Middlewares adicionales**
app.use(express.json());
app.use(cookieParser());

// **Endpoint de health check**
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// **Endpoint para recibir tareas**
app.post('/api/tasks', async (req, res) => {
  const { appraisalId, appraisalValue, description } = req.body;

  // Validación de los campos requeridos
  if (!appraisalId || !appraisalValue || !description) {
    return res.status(400).json({ success: false, message: 'Faltan campos requeridos.' });
  }

  try {
    // Inicializar Pub/Sub (se puede mover fuera para optimizar)
    const pubsub = new PubSub({
      projectId: config.GCP_PROJECT_ID,
    });

    // Publicar el mensaje en Pub/Sub
    const dataBuffer = Buffer.from(JSON.stringify({ id: appraisalId, appraisalValue, description }));
    await pubsub.topic('appraisal-tasks').publish(dataBuffer);

    // Responder con éxito
    res.status(200).json({ success: true, message: 'Tarea encolada exitosamente.' });
  } catch (error) {
    console.error('Error encolando tarea:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
});

// **Función principal para manejar Pub/Sub y otras inicializaciones**
async function main() {
  try {
    // Inicializar configuraciones
    await initializeConfig();
    const sheets = await initializeSheets();
        await appraisalStepsModule.initialize();

    const appraisalSteps = appraisalStepsModule.appraisalSteps(sheets, config);

    // Verificar que processAppraisal está definido
    if (typeof appraisalSteps.processAppraisal === 'function') {
      console.log('processAppraisal está definido correctamente.');
    } else {
      console.error('processAppraisal NO está definido en appraisalSteps.');
    }

const pubsub = new PubSub({
  projectId: config.GOOGLE_CLOUD_PROJECT_ID,
});

    // Nombre de la suscripción (debe existir en Pub/Sub)
    const subscriptionName = 'appraisal-tasks-subscription';
    const subscription = pubsub.subscription(subscriptionName);

    // Función para publicar mensajes fallidos en la DLQ
    async function publishToFailedTopic(messageData) {
      const failedTopicName = 'appraisals-failed';
      const failedTopic = pubsub.topic(failedTopicName);

      // Verificar si el topic de DLQ existe, si no, crearlo
      const [exists] = await failedTopic.exists();
      if (!exists) {
        await failedTopic.create();
        console.log(`Topic de DLQ '${failedTopicName}' creado.`);
      }

      // Publicar el mensaje en la DLQ
      const messageId = await failedTopic.publishMessage({ data: Buffer.from(JSON.stringify(messageData)) });
      console.log(`Mensaje publicado en '${failedTopicName}' con ID: ${messageId}`);
    }

    // Función para manejar los mensajes recibidos de Pub/Sub
    async function messageHandler(message) {
      try {
        // Parsear el mensaje
        const data = JSON.parse(message.data.toString());
        console.log('Mensaje recibido:', data);

        const { id, appraisalValue, description } = data;

        // Validar los datos recibidos
        if (!id || !appraisalValue || !description) {
          throw new Error('Datos incompletos en el mensaje.');
        }

        // Lógica para procesar la apreciación
        await appraisalSteps.processAppraisal(id, appraisalValue, description);

        // Acknowledge del mensaje después de procesarlo exitosamente
        message.ack();
        console.log(`Mensaje procesado y reconocido: ${id}`);
      } catch (error) {
        console.error('Error procesando el mensaje:', error);

        try {
          // Publicar el mensaje fallido en la DLQ
          const data = JSON.parse(message.data.toString());
          await publishToFailedTopic(data);
        } catch (pubsubError) {
          console.error('Error al publicar en DLQ:', pubsubError);
          // Opcional: podrías implementar lógica adicional como alertas
        }

        // Reconocer el mensaje original para evitar reintentos
        message.ack();
        console.log(`Mensaje reconocido tras fallo en el procesamiento.`);
      }
    }

    // Escuchar mensajes
    subscription.on('message', messageHandler);

    // Manejar errores en la suscripción
    subscription.on('error', (error) => {
      console.error('Error en la suscripción de Pub/Sub:', error);
      // Opcional: podrías implementar lógica para reiniciar la suscripción o alertas
    });

    console.log('[processor.js] Escuchando tareas de tasaciones...');
  } catch (error) {
    console.error('Error iniciando el procesador:', error);
    process.exit(1); // Salir con fallo
  }
}

main();

// **Iniciar el Servidor Express**
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor backend corriendo en el puerto ${PORT}`);
});
