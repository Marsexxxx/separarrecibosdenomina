import PyPDF2

with open("recibos.pdf", "rb") as file:
    lector = PyPDF2.PdfReader(file)
    # Extraemos solo el texto de la página 0 (la primera)
    texto = lector.pages[0].extract_text()
    
    print("--- ASÍ LEE EL PDF LA COMPUTADORA ---")
    print(texto)