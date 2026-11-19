// Configuramos el motor de lectura de PDF
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// Variable global para almacenar los empleados para el buscador
let empleadosGlobal = [];
let miGrafica = null; // Guardará la instancia de la gráfica

document.getElementById('btnProcesar').addEventListener('click', async () => {
    const csvFile = document.getElementById('csvInput').files[0];
    const pdfFile = document.getElementById('pdfInput').files[0];
    const estado = document.getElementById('estado');
    const btnProcesar = document.getElementById('btnProcesar');
    const dashboard = document.getElementById('dashboard');

    if (!csvFile || !pdfFile) {
        estado.style.color = "red";
        estado.innerText = "⚠️ Por favor, carga tu CSV y el PDF de nóminas primero.";
        return;
    }

    estado.style.color = "rgb(0, 143, 76)";
    estado.innerText = "⏳ Leyendo tu lista de Excel (CSV)...";
    btnProcesar.disabled = true;
    dashboard.style.display = "none"; // Ocultamos dashboard si se vuelve a procesar

    try {
        const dictEmpleados = await parseCSV(csvFile);

        estado.innerText = "⏳ Abriendo el PDF... (esto tomará unos segundos)";

        const arrayBuffer = await pdfFile.arrayBuffer();
        const pdfjsDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pdfLibDoc = await PDFLib.PDFDocument.load(arrayBuffer);

        const numPages = pdfjsDoc.numPages;
        const supervisorDocs = {};

        // Recorremos el PDF página por página (LÓGICA INTACTA)
        for (let i = 1; i <= numPages; i++) {
            estado.innerText = `🔍 Escaneando y separando página ${i} de ${numPages}...`;

            const page = await pdfjsDoc.getPage(i);
            const textContent = await page.getTextContent();
            const fullText = textContent.items.map(item => item.str).join(' ');

            let supervisor = "Sin_Asignar";

            for (const id in dictEmpleados) {
                const regex = new RegExp(`\\b0*${id}\\b`);
                if (regex.test(fullText)) {
                    supervisor = dictEmpleados[id];
                    break;
                }
            }

            if (!supervisorDocs[supervisor]) {
                supervisorDocs[supervisor] = await PDFLib.PDFDocument.create();
            }

            const [copiedPage] = await supervisorDocs[supervisor].copyPages(pdfLibDoc, [i - 1]);
            supervisorDocs[supervisor].addPage(copiedPage);
        }

        estado.innerText = "📦 Empacando los PDFs de todos los supervisores...";

        const zip = new JSZip();
        for (const [supervisor, doc] of Object.entries(supervisorDocs)) {
            const pdfBytes = await doc.save();
            zip.file(`${supervisor}_Nominas.pdf`, pdfBytes);
        }

        const zipBlob = await zip.generateAsync({ type: "blob" });

        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipBlob);
        link.download = "Nominas_Separadas.zip";
        link.click();

        estado.style.color = "rgb(0, 143, 76)";
        estado.innerText = "✅ Las nóminas se han descargado en un archivo ZIP.";

        // --- MAGIA DEL DASHBOARD ---

        // 1. Obtener la cantidad de personal a cargo extrayendo el conteo de hojas de cada PDF generado
        const labels = Object.keys(supervisorDocs);
        const dataCounts = labels.map(sup => supervisorDocs[sup].getPageCount());

        // 2. Mostrar el Dashboard
        dashboard.style.display = 'block';

        // 3. Dibujar gráfica y tabla
        renderChart(labels, dataCounts);
        renderTable(empleadosGlobal);

    } catch (error) {
        console.error(error);
        estado.style.color = "red";
        estado.innerText = "❌ Ocurrió un error al procesar: " + error.message;
    } finally {
        btnProcesar.disabled = false;
    }
});

// Función para leer tu archivo CSV (Ligeramente modificada para guardar los nombres sin afectar la lógica de separación)
function parseCSV(file) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: function (results) {
                const dict = {};
                empleadosGlobal = []; // Limpiamos la lista global
                results.data.forEach(row => {
                    if (row.ID_Empleado && row.Supervisor) {
                        dict[row.ID_Empleado.trim()] = row.Supervisor.trim();
                        // Guardamos datos adicionales para el buscador
                        empleadosGlobal.push({
                            id: row.ID_Empleado.trim(),
                            nombre: row.Nombre ? row.Nombre.trim() : '-',
                            supervisor: row.Supervisor.trim()
                        });
                    }
                });
                resolve(dict);
            },
            error: function (err) {
                reject(err);
            }
        });
    });
}

// --- FUNCIONALIDAD DEL BUSCADOR DINÁMICO ---
document.getElementById('buscador').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filas = document.querySelectorAll('#tablaEmpleados tbody tr');

    filas.forEach(fila => {
        const textoFila = fila.innerText.toLowerCase();
        // Si el texto de la fila incluye lo que escribes, se muestra; si no, se oculta.
        fila.style.display = textoFila.includes(term) ? '' : 'none';
    });
});

// --- DIBUJAR LA TABLA ---
function renderTable(empleados) {
    const container = document.getElementById('listaEmpleados');
    let html = '<table id="tablaEmpleados" style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">';
    html += '<thead style="position: sticky; top: 0; background-color: rgb(0, 143, 76); color: white;"><tr>';
    html += '<th style="padding: 10px;">ID</th>';
    html += '<th style="padding: 10px;">Nombre</th>';
    html += '<th style="padding: 10px;">Supervisor</th>';
    html += '</tr></thead><tbody>';

    empleados.forEach(emp => {
        html += `<tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 8px; font-weight: bold;">${emp.id}</td>
            <td style="padding: 8px;">${emp.nombre}</td>
            <td style="padding: 8px;">${emp.supervisor}</td>
        </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

// --- DIBUJAR LA GRÁFICA CON TUS COLORES OFICIALES ---
function renderChart(labels, data) {
    const ctx = document.getElementById('graficaPastel').getContext('2d');

    // Si ya existía una gráfica anterior (porque procesaste 2 veces), la borramos para que no se encimen
    if (miGrafica) {
        miGrafica.destroy();
    }

    miGrafica = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    'rgb(0, 143, 76)',    // Verde Principal ASR
                    'rgb(126, 195, 74)',  // Verde Secundario
                    'rgb(188, 216, 83)',  // Verde Claro
                    'rgb(0, 58, 112)',    // Azul Marino
                    'rgb(255, 221, 9)',   // Amarillo
                    'rgb(219, 107, 48)',  // Naranja
                    'rgb(164, 219, 232)', // Azul Claro
                    'rgb(113, 153, 73)',  // Verde Oliva
                    'rgb(99, 100, 102)'   // Gris Oscuro
                ],
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                }
            }
        }
    });
}