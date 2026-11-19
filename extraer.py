import PyPDF2
import re
import csv

archivo_pdf = "recibos.pdf"
archivo_csv = "lista_empleados.csv"

# Regla a prueba de balas:
# 1. \s{2,} -> Busca 2 o más espacios
# 2. ([A-Za-z0-9]+) -> Captura el ID (sean J, 0 o 911)
# 3. \n -> Salto de línea
# 4. ([^\n]+) -> Captura TODO el nombre (sin importar acentos o símbolos raros)
# 5. \n -> Salto de línea
# 6. [A-ZÑ]{4}\d{6} -> Valida que lo que sigue es un RFC
regex_magico = r"\s{2,}([A-Za-z0-9]+)\n([^\n]+)\n[A-ZÑ]{4}\d{6}"

empleados = {}

with open(archivo_pdf, "rb") as file:
    lector = PyPDF2.PdfReader(file)
    
    for num_pagina in range(len(lector.pages)):
        texto = lector.pages[num_pagina].extract_text()
        
        match = re.search(regex_magico, texto)
        
        if match:
            id_empleado = match.group(1).strip()
            nombre = match.group(2).strip()
            empleados[id_empleado] = nombre

with open(archivo_csv, "w", newline="", encoding="utf-8-sig") as csvfile:
    escritor = csv.writer(csvfile)
    escritor.writerow(["ID_Empleado", "Nombre", "Supervisor"])
    
    for id_emp, nom in empleados.items():
        escritor.writerow([id_emp, nom, ""])

print(f"¡Éxito! Se encontraron {len(empleados)} empleados únicos.")