import sys
import time
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("sopi.voice_detector")

try:
    import speech_recognition as sr
    import requests
except ImportError as e:
    logger.error(f"Failed to import required libraries for wake word listener: {e}")
    logger.info("Please ensure 'speechrecognition', 'pyaudio', and 'requests' are installed.")
    sys.exit(1)

def main():
    logger.info("Initializing wake-word detector...")
    r = sr.Recognizer()
    
    # Try opening the default microphone
    try:
        mic = sr.Microphone()
    except Exception as e:
        logger.error(f"Could not access microphone: {e}")
        logger.info("Wake word listener will exit. Please use Push-to-Talk.")
        sys.exit(1)
        
    logger.info("Calibrating microphone for ambient noise (3 seconds)...")
    try:
        with mic as source:
            r.adjust_for_ambient_noise(source, duration=3)
    except Exception as e:
        logger.error(f"Error adjusting for ambient noise: {e}")
        sys.exit(1)
        
    logger.info("Listening for wake word 'Sopi'...")
    
    while True:
        try:
            with mic as source:
                # Phrase time limit keeps listening chunks small (e.g. 2.5 seconds)
                audio = r.listen(source, phrase_time_limit=2.5)
            
            # Using Google's free online API since it is very fast, streaming, and built-in
            text = r.recognize_google(audio).lower()
            logger.info(f"Heard candidate: '{text}'")
            
            if "sopi" in text or "soapy" in text or "sophie" in text or "shopi" in text:
                logger.info("WAKE WORD MATCHED!")
                try:
                    # Notify local FastAPI server
                    requests.post("http://127.0.0.1:8000/api/wake", timeout=1)
                except Exception as ex:
                    logger.error(f"Could not connect to FastAPI server at http://127.0.0.1:8000/api/wake: {ex}")
                    
        except sr.UnknownValueError:
            # Did not recognize any speech
            pass
        except sr.RequestError as e:
            logger.warning(f"Google speech service request error; check internet connection: {e}")
            time.sleep(2)
        except Exception as e:
            logger.error(f"Unexpected error in listener loop: {e}")
            time.sleep(1)

if __name__ == "__main__":
    main()
