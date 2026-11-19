pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

let registrosTabla = [];
let miGrafica = null;
let datosGrafica = { labels: [], counts: [], desgloses: {} };
let supervisorPdfBytes = {};
let supervisorConteos = {};
let impresosSet = new Set();
let pdfLibDocGlobal = null;
let zipBlobGlobal = null;
let filtroSupervisor = null;
let filtroSupervisorBase = null;
let filtroSinRecibo = false;
let ultimoPrintUrl = null;

const ICONO_IMPRIMIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>';
const ICONO_DESCARGAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';

const barValuePlugin = {
    id: 'barValuePlugin',
    afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const meta = chart.getDatasetMeta(0);
        if (!meta || !meta.data) return;

        ctx.save();
        ctx.font = '600 11.5px Inter, Segoe UI, sans-serif';
        ctx.fillStyle = 'rgb(99, 100, 102)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        meta.data.forEach((bar, index) => {
            const valor = chart.data.datasets[0].data[index];
            ctx.fillText(String(valor), bar.x + 8, bar.y);
        });
        ctx.restore();
    }
};

function obtenerSupervisorBase(nombre) {
    if (!nombre || nombre === 'Sin_Asignar') return 'Sin_Asignar';
    const base = nombre.split('(')[0].trim();
    return base || nombre.trim();
}

function obtenerSubgrupo(nombre) {
    const match = nombre.match(/\(([^)]+)\)/);
    return match ? match[1].trim() : null;
}

document.getElementById('csvInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    const span = document.getElementById('csvNombre');
    const label = document.getElementById('labelCsv');
    span.textContent = file ? file.name : 'Seleccionar CSV';
    label.classList.toggle('cargado', Boolean(file));
});

document.getElementById('pdfInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    const span = document.getElementById('pdfNombre');
    const label = document.getElementById('labelPdf');
    span.textContent = file ? file.name : 'Seleccionar PDF';
    label.classList.toggle('cargado', Boolean(file));
});

document.getElementById('btnProcesar').addEventListener('click', async () => {
    const csvFile = document.getElementById('csvInput').files[0];
    const pdfFile = document.getElementById('pdfInput').files[0];
    const estado = document.getElementById('estado');
    const btnProcesar = document.getElementById('btnProcesar');
    const btnDescargarZip = document.getElementById('btnDescargarZip');
    const dashboard = document.getElementById('dashboard');

    if (!csvFile || !pdfFile) {
        estado.style.color = 'rgb(219, 107, 48)';
        estado.innerText = 'Carga tu CSV y el PDF de nóminas primero.';
        return;
    }

    estado.style.color = 'rgb(0, 143, 76)';
    estado.innerText = 'Leyendo lista CSV...';
    btnProcesar.disabled = true;
    btnDescargarZip.classList.add('oculto');
    dashboard.classList.add('oculto');

    try {
        const { dict, empleados, empleadosPorId } = await parseCSV(csvFile);

        estado.innerText = 'Abriendo PDF...';

        const arrayBuffer = await pdfFile.arrayBuffer();
        const pdfjsDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pdfLibDoc = await PDFLib.PDFDocument.load(arrayBuffer);

        pdfLibDocGlobal = pdfLibDoc;
        const numPages = pdfjsDoc.numPages;
        const supervisorDocs = {};
        const sinAsignarRegistros = [];

        for (let i = 1; i <= numPages; i++) {
            estado.innerText = `Procesando página ${i} de ${numPages}...`;

            const page = await pdfjsDoc.getPage(i);
            const textContent = await page.getTextContent();
            const fullText = textContent.items.map(item => item.str).join(' ');

            let supervisor = 'Sin_Asignar';
            let matchedId = null;

            for (const id in dict) {
                const regex = new RegExp(`\\b0*${id}\\b`);
                if (regex.test(fullText)) {
                    supervisor = dict[id];
                    matchedId = id;
                    break;
                }
            }

            if (matchedId && empleadosPorId[matchedId]) {
                empleadosPorId[matchedId].pages.push(i - 1);
            } else {
                sinAsignarRegistros.push({
                    id: `Pág. ${i}`,
                    nombre: 'Sin asignar',
                    supervisor: 'Sin_Asignar',
                    pages: [i - 1],
                    esSinAsignar: true
                });
            }

            if (!supervisorDocs[supervisor]) {
                supervisorDocs[supervisor] = await PDFLib.PDFDocument.create();
            }

            const [copiedPage] = await supervisorDocs[supervisor].copyPages(pdfLibDoc, [i - 1]);
            supervisorDocs[supervisor].addPage(copiedPage);
        }

        estado.innerText = 'Generando archivo ZIP...';

        supervisorPdfBytes = {};
        supervisorConteos = {};
        impresosSet = new Set();
        filtroSupervisor = null;
        filtroSupervisorBase = null;
        filtroSinRecibo = false;

        const zip = new JSZip();
        for (const [supervisor, doc] of Object.entries(supervisorDocs)) {
            const pdfBytes = await doc.save();
            supervisorPdfBytes[supervisor] = pdfBytes;
            supervisorConteos[supervisor] = doc.getPageCount();
            zip.file(`${supervisor}_Nominas.pdf`, pdfBytes);
        }

        zipBlobGlobal = await zip.generateAsync({ type: 'blob' });
        descargarBlob(zipBlobGlobal, 'Nominas_Separadas.zip');

        estado.style.color = 'rgb(0, 143, 76)';
        estado.innerText = 'Nóminas descargadas en Nominas_Separadas.zip';

        registrosTabla = [...empleados, ...sinAsignarRegistros];

        const paquetesOrdenados = Object.keys(supervisorDocs).sort((a, b) => {
            if (a === 'Sin_Asignar') return 1;
            if (b === 'Sin_Asignar') return -1;
            return a.localeCompare(b, 'es');
        });

        const totalesAgrupados = {};
        const desgloses = {};
        Object.keys(supervisorDocs).forEach(sup => {
            const base = obtenerSupervisorBase(sup);
            const conteo = supervisorConteos[sup];
            totalesAgrupados[base] = (totalesAgrupados[base] || 0) + conteo;
            if (!desgloses[base]) desgloses[base] = [];
            desgloses[base].push({
                nombre: sup,
                sub: obtenerSubgrupo(sup),
                conteo
            });
        });

        Object.values(desgloses).forEach(lista => {
            lista.sort((a, b) => b.conteo - a.conteo);
        });

        const labelsAgrupados = Object.keys(totalesAgrupados).sort((a, b) => {
            if (a === 'Sin_Asignar') return 1;
            if (b === 'Sin_Asignar') return -1;
            return totalesAgrupados[b] - totalesAgrupados[a];
        });

        datosGrafica = {
            labels: labelsAgrupados,
            counts: labelsAgrupados.map(base => totalesAgrupados[base]),
            desgloses
        };

        actualizarKPIs(numPages, labelsAgrupados, empleados);

        document.body.classList.add('modo-dashboard');
        btnDescargarZip.classList.remove('oculto');
        dashboard.classList.remove('oculto');
        document.getElementById('buscador').value = '';

        renderSupervisores(paquetesOrdenados);
        renderChart();
        renderTable(registrosTabla);
        aplicarFiltros();

    } catch (error) {
        console.error(error);
        estado.style.color = 'rgb(219, 107, 48)';
        estado.innerText = 'Error al procesar: ' + error.message;
    } finally {
        btnProcesar.disabled = false;
    }
});

document.getElementById('btnDescargarZip').addEventListener('click', () => {
    if (zipBlobGlobal) {
        descargarBlob(zipBlobGlobal, 'Nominas_Separadas.zip');
    }
});

document.getElementById('buscador').addEventListener('input', aplicarFiltros);

document.getElementById('btnLimpiarFiltro').addEventListener('click', () => {
    filtroSupervisor = null;
    filtroSupervisorBase = null;
    filtroSinRecibo = false;
    actualizarEstadoSupervisores();
    renderChart();
    aplicarFiltros();
});

document.getElementById('cardKpiTotal').addEventListener('click', () => {
    filtroSupervisor = null;
    filtroSupervisorBase = null;
    filtroSinRecibo = false;
    document.getElementById('buscador').value = '';
    actualizarEstadoSupervisores();
    renderChart();
    aplicarFiltros();
});

document.getElementById('cardKpiSinAsignar').addEventListener('click', () => {
    if ((supervisorConteos['Sin_Asignar'] || 0) === 0) return;
    filtroSinRecibo = false;
    filtroSupervisorBase = null;
    filtroSupervisor = filtroSupervisor === 'Sin_Asignar' ? null : 'Sin_Asignar';
    actualizarEstadoSupervisores();
    renderChart();
    aplicarFiltros();
});

document.getElementById('cardKpiSinRecibo').addEventListener('click', () => {
    filtroSupervisor = null;
    filtroSupervisorBase = null;
    filtroSinRecibo = !filtroSinRecibo;
    actualizarEstadoSupervisores();
    renderChart();
    aplicarFiltros();
});

function parseCSV(file) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: function (results) {
                const dict = {};
                const empleados = [];
                const empleadosPorId = {};
                results.data.forEach(row => {
                    if (row.ID_Empleado && row.Supervisor) {
                        const id = row.ID_Empleado.trim();
                        const supervisor = row.Supervisor.trim();
                        const emp = {
                            id,
                            nombre: row.Nombre ? row.Nombre.trim() : '-',
                            supervisor,
                            pages: [],
                            esSinAsignar: false
                        };
                        dict[id] = supervisor;
                        empleados.push(emp);
                        empleadosPorId[id] = emp;
                    }
                });
                resolve({ dict, empleados, empleadosPorId });
            },
            error: function (err) {
                reject(err);
            }
        });
    });
}

function actualizarKPIs(totalPaginas, labelsAgrupados, empleadosCSV) {
    const sinAsignar = supervisorConteos['Sin_Asignar'] || 0;
    const totalSupervisores = labelsAgrupados.filter(s => s !== 'Sin_Asignar').length;
    const sinRecibo = empleadosCSV.filter(e => e.pages.length === 0).length;

    document.getElementById('kpiTotal').innerText = totalPaginas;
    document.getElementById('kpiSupervisores').innerText = totalSupervisores;
    document.getElementById('kpiSinAsignar').innerText = sinAsignar;
    document.getElementById('kpiSinRecibo').innerText = sinRecibo;
    document.getElementById('contadorGrupos').innerText = `${totalSupervisores} supervisores`;

    document.getElementById('cardKpiSinAsignar').classList.toggle('kpi-alerta', sinAsignar > 0);
    document.getElementById('cardKpiSinRecibo').classList.toggle('kpi-alerta', sinRecibo > 0);
}

function renderSupervisores(paquetes) {
    const contenedor = document.getElementById('listaSupervisores');
    contenedor.innerHTML = '';

    paquetes.forEach(sup => {
        const item = document.createElement('div');
        item.className = 'supervisor-item';
        item.dataset.supervisor = sup;
        item.dataset.base = obtenerSupervisorBase(sup);
        if (sup === 'Sin_Asignar') {
            item.classList.add('sin-asignar');
        }

        const info = document.createElement('div');
        info.className = 'supervisor-info';

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'supervisor-check';
        check.checked = impresosSet.has(sup);
        check.addEventListener('change', () => {
            if (check.checked) {
                impresosSet.add(sup);
            } else {
                impresosSet.delete(sup);
            }
            actualizarEstadoSupervisores();
        });

        const nombreBtn = document.createElement('div');
        nombreBtn.className = 'supervisor-nombre-btn';
        nombreBtn.title = sup;
        nombreBtn.addEventListener('click', () => {
            filtroSinRecibo = false;
            filtroSupervisorBase = null;
            filtroSupervisor = filtroSupervisor === sup ? null : sup;
            actualizarEstadoSupervisores();
            renderChart();
            aplicarFiltros();
        });

        const base = obtenerSupervisorBase(sup);
        const sub = obtenerSubgrupo(sup);

        const nombre = document.createElement('span');
        nombre.className = 'supervisor-nombre';
        nombre.textContent = sub ? base : sup;
        nombreBtn.appendChild(nombre);

        if (sub) {
            const tagSub = document.createElement('span');
            tagSub.className = 'supervisor-sub';
            tagSub.textContent = sub;
            nombreBtn.appendChild(tagSub);
        }

        const conteo = document.createElement('span');
        conteo.className = 'supervisor-conteo';
        conteo.textContent = supervisorConteos[sup];

        info.appendChild(check);
        info.appendChild(nombreBtn);
        info.appendChild(conteo);

        const acciones = document.createElement('div');
        acciones.className = 'supervisor-acciones';

        const btnImprimir = document.createElement('button');
        btnImprimir.type = 'button';
        btnImprimir.className = 'btn-ghost';
        btnImprimir.innerHTML = `${ICONO_IMPRIMIR} Imprimir`;
        btnImprimir.addEventListener('click', () => {
            imprimirPdfBytes(supervisorPdfBytes[sup]);
            impresosSet.add(sup);
            actualizarEstadoSupervisores();
        });

        const btnPdf = document.createElement('button');
        btnPdf.type = 'button';
        btnPdf.className = 'btn-ghost btn-ghost-icon';
        btnPdf.title = 'Descargar PDF';
        btnPdf.innerHTML = ICONO_DESCARGAR;
        btnPdf.addEventListener('click', () => {
            const blob = new Blob([supervisorPdfBytes[sup]], { type: 'application/pdf' });
            descargarBlob(blob, `${sup}_Nominas.pdf`);
        });

        acciones.appendChild(btnImprimir);
        acciones.appendChild(btnPdf);

        item.appendChild(info);
        item.appendChild(acciones);
        contenedor.appendChild(item);
    });

    actualizarEstadoSupervisores();
}

function actualizarEstadoSupervisores() {
    const items = document.querySelectorAll('#listaSupervisores .supervisor-item');
    items.forEach(item => {
        const sup = item.dataset.supervisor;
        const base = item.dataset.base;
        const impreso = impresosSet.has(sup);
        const estaActivo = filtroSupervisor === sup || (filtroSupervisorBase && base === filtroSupervisorBase);
        item.classList.toggle('impreso', impreso);
        item.classList.toggle('activo', Boolean(estaActivo));
        const check = item.querySelector('.supervisor-check');
        if (check) {
            check.checked = impreso;
        }
    });

    const badge = document.getElementById('contadorImpresos');
    badge.innerText = `${impresosSet.size} / ${items.length} impresos`;
    badge.classList.toggle('completo', items.length > 0 && impresosSet.size === items.length);
}

function renderTable(empleados) {
    const container = document.getElementById('listaEmpleados');
    container.innerHTML = '';

    const table = document.createElement('table');
    table.id = 'tablaEmpleados';

    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>ID</th><th>Nombre</th><th>Supervisor</th><th class="col-accion">Recibo</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    empleados.forEach((emp, index) => {
        const tr = document.createElement('tr');
        tr.dataset.index = index;

        const tdId = document.createElement('td');
        tdId.className = 'col-id';
        tdId.textContent = emp.id;

        const tdNombre = document.createElement('td');
        tdNombre.textContent = emp.nombre;

        const tdSup = document.createElement('td');
        tdSup.className = 'col-sup';
        tdSup.textContent = emp.supervisor;

        const tdAccion = document.createElement('td');
        tdAccion.className = 'col-accion';

        if (emp.pages.length > 0) {
            const btnPrint = document.createElement('button');
            btnPrint.type = 'button';
            btnPrint.className = 'btn-ghost btn-ghost-icon';
            btnPrint.title = 'Imprimir recibo';
            btnPrint.innerHTML = ICONO_IMPRIMIR;
            btnPrint.addEventListener('click', () => imprimirEmpleadoIndividual(emp));
            tdAccion.appendChild(btnPrint);
        } else {
            const badge = document.createElement('span');
            badge.className = 'badge-sin-recibo';
            badge.textContent = 'Sin recibo';
            tdAccion.appendChild(badge);
        }

        tr.appendChild(tdId);
        tr.appendChild(tdNombre);
        tr.appendChild(tdSup);
        tr.appendChild(tdAccion);
        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.appendChild(table);
}

function aplicarFiltros() {
    const term = document.getElementById('buscador').value.trim().toLowerCase();
    const filas = document.querySelectorAll('#tablaEmpleados tbody tr');
    let visibles = 0;

    filas.forEach(fila => {
        const emp = registrosTabla[Number(fila.dataset.index)];
        const coincideTexto = !term || `${emp.id} ${emp.nombre} ${emp.supervisor}`.toLowerCase().includes(term);
        const coincideSup = !filtroSupervisor || emp.supervisor === filtroSupervisor;
        const coincideBase = !filtroSupervisorBase || obtenerSupervisorBase(emp.supervisor) === filtroSupervisorBase;
        const coincideSinRecibo = !filtroSinRecibo || (!emp.esSinAsignar && emp.pages.length === 0);

        const mostrar = coincideTexto && coincideSup && coincideBase && coincideSinRecibo;
        fila.style.display = mostrar ? '' : 'none';
        if (mostrar) visibles++;
    });

    document.getElementById('contadorTabla').innerText = `${visibles} registros`;

    const barra = document.getElementById('barraFiltroActivo');
    const texto = document.getElementById('textoFiltroActivo');
    if (filtroSupervisor) {
        texto.innerText = `Paquete: ${filtroSupervisor}`;
        barra.classList.remove('oculto');
    } else if (filtroSupervisorBase) {
        texto.innerText = `Supervisor: ${filtroSupervisorBase}`;
        barra.classList.remove('oculto');
    } else if (filtroSinRecibo) {
        texto.innerText = 'Filtro: En CSV sin Recibo';
        barra.classList.remove('oculto');
    } else {
        barra.classList.add('oculto');
    }
}

async function imprimirEmpleadoIndividual(emp) {
    if (!pdfLibDocGlobal || emp.pages.length === 0) return;
    const nuevoPdf = await PDFLib.PDFDocument.create();
    const paginas = await nuevoPdf.copyPages(pdfLibDocGlobal, emp.pages);
    paginas.forEach(p => nuevoPdf.addPage(p));
    const pdfBytes = await nuevoPdf.save();
    imprimirPdfBytes(pdfBytes);
}

function imprimirPdfBytes(pdfBytes) {
    if (ultimoPrintUrl) {
        URL.revokeObjectURL(ultimoPrintUrl);
    }
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    ultimoPrintUrl = URL.createObjectURL(blob);

    let iframe = document.getElementById('printFrame');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'printFrame';
        iframe.className = 'print-frame';
        document.body.appendChild(iframe);
    }

    iframe.onload = () => {
        setTimeout(() => {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        }, 300);
    };
    iframe.src = ultimoPrintUrl;
}

function descargarBlob(blob, nombreArchivo) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nombreArchivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderChart() {
    const { labels, counts, desgloses } = datosGrafica;
    if (!labels.length) return;

    const contenedor = document.getElementById('contenedorGrafica');
    contenedor.style.height = `${Math.max(240, labels.length * 32)}px`;

    const ctx = document.getElementById('graficaBarras').getContext('2d');
    if (miGrafica) {
        miGrafica.destroy();
    }

    const colores = labels.map(label => {
        const esSinAsignar = label === 'Sin_Asignar';
        const hayFiltroBase = Boolean(filtroSupervisorBase);
        const esSeleccionado = !hayFiltroBase || filtroSupervisorBase === label;
        if (esSinAsignar) {
            return esSeleccionado ? 'rgb(219, 107, 48)' : 'rgba(219, 107, 48, 0.25)';
        }
        return esSeleccionado ? 'rgb(0, 143, 76)' : 'rgba(167, 169, 172, 0.35)';
    });

    miGrafica = new Chart(ctx, {
        type: 'bar',
        plugins: [barValuePlugin],
        data: {
            labels,
            datasets: [{
                data: counts,
                backgroundColor: colores,
                hoverBackgroundColor: labels.map(l => l === 'Sin_Asignar' ? 'rgb(219, 107, 48)' : 'rgb(126, 195, 74)'),
                borderRadius: 5,
                borderSkipped: false,
                barThickness: 18
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            layout: {
                padding: { right: 34 }
            },
            onHover: (event, elements) => {
                event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
            },
            onClick: (event, elements) => {
                if (!elements.length) return;
                const supBase = labels[elements[0].index];
                filtroSinRecibo = false;
                filtroSupervisor = null;
                filtroSupervisorBase = filtroSupervisorBase === supBase ? null : supBase;
                actualizarEstadoSupervisores();
                renderChart();
                aplicarFiltros();
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#111315',
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: (context) => `Total: ${context.raw} recibos`,
                        afterBody: (items) => {
                            const base = items[0].label;
                            const lista = desgloses[base] || [];
                            if (lista.length <= 1) return [];
                            return lista.map(d => `  ${d.sub || d.nombre}: ${d.conteo}`);
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(167, 169, 172, 0.18)',
                        drawBorder: false
                    },
                    ticks: {
                        precision: 0,
                        color: 'rgb(99, 100, 102)',
                        font: { size: 11 }
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        color: '#111315',
                        font: { size: 11.5, weight: '500' }
                    }
                }
            }
        }
    });
}