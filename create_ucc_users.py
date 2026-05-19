import json
import urllib.request
import urllib.error

GATEWAY = 'http://localhost:8002'

def request(path, data=None, token=None, method=None):
    url = GATEWAY + path
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'

    if method is None:
        method = 'POST' if data else 'GET'

    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode('utf-8') if data else None,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            error_data = json.loads(e.read().decode())
        except Exception:
            error_data = {'error': str(e)}
        return e.code, error_data
    except Exception as e:
        return 0, {'error': str(e)}


def create_docente(token, email, password, first_name, last_name, document_id, career_label):
    """Crea usuario docente en auth-service y registra en academic_service."""
    print(f'  Creando {first_name} {last_name} ({career_label})...')

    status, data = request('/auth/create-user', {
        'email': email,
        'password': password,
        'role': 'docente',
        'first_name': first_name,
        'last_name': last_name,
        'document_id': document_id,
    }, token=token)

    def update_existing_teacher_by_email():
        st3, d3 = request('/academic/api/teachers/', token=token, method='GET')
        if st3 == 200 and isinstance(d3, list):
            for t in d3:
                if t.get('email') == email:
                    request(f'/academic/api/teachers/{t["id"]}', {
                        'email': email,
                        'nombres': first_name,
                        'apellidos': last_name,
                        'nombre': f'{first_name} {last_name}',
                        'document_id': document_id,
                    }, token=token, method='PUT')
                    print(f'    ~ Ya existía (teacher_id={t["id"]})')
                    return t['id']
        return None

    if status not in (200, 201):
        print(f'    ! Auth ya existe o error {status}: {data.get("detail", data)}')
        if status == 409:
            existing_teacher_id = update_existing_teacher_by_email()
            if existing_teacher_id:
                return existing_teacher_id
        # Intentar obtener user_id existente
        st2, d2 = request('/auth/users/', token=token, method='GET')
        user_id = None
        if st2 == 200 and isinstance(d2, list):
            for u in d2:
                if u.get('email') == email:
                    user_id = u.get('id')
                    break
    else:
        user_id = data.get('user_id')

    if not user_id:
        print(f'    ! No se pudo obtener user_id para {email}')
        existing_teacher_id = update_existing_teacher_by_email()
        if existing_teacher_id:
            return existing_teacher_id
        return None

    # Registrar en academic_service
    status2, data2 = request('/academic/api/teachers/', {
        'user_id': user_id,
        'email': email,
        'first_name': first_name,
        'last_name': last_name,
        'name': f'{first_name} {last_name}',
        'document_id': document_id,
    }, token=token)

    if status2 in (200, 201):
        teacher_id = data2.get('id')
        print(f'    + Docente registrado (teacher_id={teacher_id}, user_id={user_id})')
        return teacher_id
    elif status2 == 409:
        # Ya existe, obtener su id
        existing_teacher_id = update_existing_teacher_by_email()
        if existing_teacher_id:
            return existing_teacher_id
        print(f'    ! No se pudo obtener teacher_id existente para {email}')
        return None
    else:
        print(f'    ! Error registrando teacher {status2}: {data2}')
        return None


def assign_course(token, teacher_id, course_id, course_code):
    status, data = request('/academic/api/assignments/', {
        'teacher_id': teacher_id,
        'course_id': course_id,
    }, token=token)
    if status in (200, 201):
        print(f'      -> Asignado a {course_code}')
    else:
        print(f'      ~ Asignación {course_code}: {data.get("detail", status)}')


def create_estudiante(token, email, password, first_name, last_name, document_id, program):
    """Crea usuario estudiante en auth y registra/actualiza en student_service."""
    print(f'  Creando estudiante {first_name} {last_name} ({program})...')

    status, data = request('/auth/create-user', {
        'email': email,
        'password': password,
        'role': 'estudiante',
        'first_name': first_name,
        'last_name': last_name,
        'document_id': document_id,
    }, token=token)

    user_id = None
    if status in (200, 201):
        user_id = data.get('user_id')
    else:
        print(f'    ! Auth ya existe o error {status}: {data.get("detail", data)}')
        st_users, users = request('/auth/users/', token=token, method='GET')
        if st_users == 200 and isinstance(users, list):
            for u in users:
                if u.get('email') == email:
                    user_id = u.get('id')
                    break

    if not user_id:
        print(f'    ! No se pudo obtener user_id para {email}')
        return None

    # Si ya existe en students, actualizar; si no, crear.
    st_students, students = request('/students/', token=token, method='GET')
    existing = None
    if st_students == 200 and isinstance(students, list):
        for s in students:
            if s.get('email') == email:
                existing = s
                break

    payload = {
        'user_id': user_id,
        'nombre': first_name,
        'apellido': last_name,
        'email': email,
        'document_id': document_id,
        'program': program,
        'status': 'activo',
    }

    if existing:
        st_upd, _ = request(f'/students/{existing["id"]}', {
            'nombre': first_name,
            'apellido': last_name,
            'email': email,
            'document_id': document_id,
            'program': program,
            'status': 'activo',
        }, token=token, method='PUT')
        if st_upd in (200, 201):
            print(f'    ~ Ya existía (student_id={existing["id"]}), actualizado')
            return existing['id']
        print(f'    ! Error actualizando estudiante {email}: {st_upd}')
        return None

    st_create, student_data = request('/students/', payload, token=token)
    if st_create in (200, 201):
        student_id = student_data.get('id')
        print(f'    + Estudiante registrado (student_id={student_id}, user_id={user_id})')
        return student_id

    print(f'    ! Error registrando estudiante {email}: {student_data}')
    return None


if __name__ == '__main__':
    print('=' * 60)
    print('CREACIÓN DE USUARIOS Y DATOS DE PRUEBA')
    print('=' * 60)

    ADMIN_EMAIL = 'admin@ucc.edu.co'
    ADMIN_PASSWORD = 'Admin123*'

    print(f'\n[1] Logueando como {ADMIN_EMAIL}...')
    status, data = request('/auth/login', {'email': ADMIN_EMAIL, 'password': ADMIN_PASSWORD})
    print(f'Status: {status}, Respuesta: {data}')
    token = data.get('access_token') if status == 200 else None

    if not token:
        print('✗ No se obtuvo token, abortando.')
        raise SystemExit(1)
    print(f'✓ Token obtenido: {token[:20]}...')

    # ─── Obtener carreras y cursos ────────────────────────────────────────────
    print('\n[2] Obteniendo carreras...')
    _, careers = request('/academic/api/careers/', token=token, method='GET')
    career_by_code = {c['code']: c for c in (careers if isinstance(careers, list) else [])}

    def get_courses(career_code):
        cid = career_by_code.get(career_code, {}).get('id')
        if not cid:
            return {}
        _, courses = request(f'/academic/api/courses/?career_id={cid}', token=token, method='GET')
        return {c['code']: c['id'] for c in (courses if isinstance(courses, list) else [])}

    print('  Cargando cursos DER, ISIS, ADM...')
    cc_der  = get_courses('DER')
    cc_isis = get_courses('ISIS')
    cc_adm  = get_courses('ADM')
    print(f'  DER={len(cc_der)} cursos, ISIS={len(cc_isis)} cursos, ADM={len(cc_adm)} cursos')

    # ─── 20 DOCENTES ──────────────────────────────────────────────────────────
    print('\n' + '=' * 60)
    print('CREACIÓN DE 20 DOCENTES')
    print('=' * 60)

    # ── 7 docentes Derecho ──
    print('\n── Facultad de Derecho (7) ──')
    t = {}

    t['der1'] = create_docente(token, 'carlos.mendoza@ucc.edu.co', 'Derecho2026*',
                               'Carlos Andres',    'Mendoza Ruiz',   '1067849306', 'DER')
    t['der2'] = create_docente(token, 'patricia.restrepo@ucc.edu.co', 'Derecho2026*',
                               'Patricia Elena',  'Restrepo Mena',  '1017342891', 'DER')
    t['der3'] = create_docente(token, 'andres.vargas@ucc.edu.co', 'Derecho2026*',
                               'Andres Felipe',    'Vargas Ortiz',    '1193456782', 'DER')
    t['der4'] = create_docente(token, 'lucia.herrera@ucc.edu.co', 'Derecho2026*',
                               'Lucia Fernanda',     'Herrera Soto',   '1045678234', 'DER')
    t['der5'] = create_docente(token, 'fernando.gomez@ucc.edu.co', 'Derecho2026*',
                               'Fernando Jose',  'Gomez Castro',     '1128934560', 'DER')
    t['der6'] = create_docente(token, 'claudia.pinto@ucc.edu.co', 'Derecho2026*',
                               'Claudia Marcela',   'Pinto Vera',     '1052341678', 'DER')
    t['der7'] = create_docente(token, 'rodrigo.castro@ucc.edu.co', 'Derecho2026*',
                               'Rodrigo Elias',   'Castro Pardo',    '1094567823', 'DER')

    # ── 7 docentes Ingeniería de Sistemas ──
    print('\n── Facultad de Ingenierías (7) ──')
    t['isis1'] = create_docente(token, 'jaime.torres@ucc.edu.co', 'Sistemas2026*',
                                'Jaime Alberto',    'Torres Luna',    '1020345678', 'ISIS')
    t['isis2'] = create_docente(token, 'sandra.morales@ucc.edu.co', 'Sistemas2026*',
                                'Sandra Milena',   'Morales Diaz',   '1078234560', 'ISIS')
    t['isis3'] = create_docente(token, 'hector.jimenez@ucc.edu.co', 'Sistemas2026*',
                                'Hector Ivan',   'Jimenez Peña',   '1035678901', 'ISIS')
    t['isis4'] = create_docente(token, 'diana.ospina@ucc.edu.co', 'Sistemas2026*',
                                'Diana Carolina',    'Ospina Rios',    '1059012345', 'ISIS')
    t['isis5'] = create_docente(token, 'miguel.ramos@ucc.edu.co', 'Sistemas2026*',
                                'Miguel Angel',   'Ramos Quiroz',     '1083456789', 'ISIS')
    t['isis6'] = create_docente(token, 'camila.diaz@ucc.edu.co', 'Sistemas2026*',
                                'Camila Andrea',   'Diaz Mejia',      '1006789012', 'ISIS')
    t['isis7'] = create_docente(token, 'ernesto.silva@ucc.edu.co', 'Sistemas2026*',
                                'Ernesto Javier',  'Silva Muñoz',     '1030123456', 'ISIS')

    # ── 6 docentes Administración ──
    print('\n── Facultad de Ciencias Económicas (6) ──')
    t['adm1'] = create_docente(token, 'rosa.martinez@ucc.edu.co', 'Admon2026*',
                               'Rosa Elena',      'Martinez Florez',  '1012567890', 'ADM')
    t['adm2'] = create_docente(token, 'tomas.guerrero@ucc.edu.co', 'Admon2026*',
                               'Tomas David',     'Guerrero Castaño',  '1056901234', 'ADM')
    t['adm3'] = create_docente(token, 'isabel.cardenas@ucc.edu.co', 'Admon2026*',
                               'Isabel Cristina',    'Cardenas Mora',  '1001234567', 'ADM')
    t['adm4'] = create_docente(token, 'alberto.nunez@ucc.edu.co', 'Admon2026*',
                               'Alberto Jose',   'Nunez Bravo',     '1025678901', 'ADM')
    t['adm5'] = create_docente(token, 'valentina.rios@ucc.edu.co', 'Admon2026*',
                               'Valentina Sofia', 'Rios Daza',      '1049012345', 'ADM')
    t['adm6'] = create_docente(token, 'guillermo.pena@ucc.edu.co', 'Admon2026*',
                               'Guillermo Leon', 'Peña Salas',      '1073456789', 'ADM')

    # ─── ASIGNACIONES DE MATERIAS ─────────────────────────────────────────────
    print('\n' + '=' * 60)
    print('ASIGNACIONES DE MATERIAS A DOCENTES')
    print('=' * 60)

    assignments = [
        # DER
        ('der1', cc_der, ['DER-101','DER-102','DER-103']),
        ('der2', cc_der, ['DER-201','DER-206','DER-207']),
        ('der3', cc_der, ['DER-301','DER-305','DER-307']),
        ('der4', cc_der, ['DER-401','DER-405','DER-406']),
        ('der5', cc_der, ['DER-501','DER-503','DER-504']),
        ('der6', cc_der, ['DER-601','DER-603','DER-604']),
        ('der7', cc_der, ['DER-701','DER-703','DER-704','DER-801','DER-802']),
        # ISIS
        ('isis1', cc_isis, ['ISIS-101','ISIS-102','ISIS-103']),
        ('isis2', cc_isis, ['ISIS-201','ISIS-203','ISIS-301']),
        ('isis3', cc_isis, ['ISIS-302','ISIS-402','ISIS-403']),
        ('isis4', cc_isis, ['ISIS-401','ISIS-501','ISIS-502']),
        ('isis5', cc_isis, ['ISIS-503','ISIS-601','ISIS-602']),
        ('isis6', cc_isis, ['ISIS-603','ISIS-701','ISIS-703']),
        ('isis7', cc_isis, ['ISIS-801','ISIS-802','ISIS-901']),
        # ADM
        ('adm1', cc_adm, ['ADM-101','ADM-102','ADM-105']),
        ('adm2', cc_adm, ['ADM-201','ADM-203','ADM-205']),
        ('adm3', cc_adm, ['ADM-301','ADM-303','ADM-306']),
        ('adm4', cc_adm, ['ADM-401','ADM-404','ADM-406']),
        ('adm5', cc_adm, ['ADM-501','ADM-503','ADM-505']),
        ('adm6', cc_adm, ['ADM-601','ADM-603','ADM-605']),
    ]

    for key, course_map, codes in assignments:
        tid = t.get(key)
        if not tid:
            continue
        print(f'\n  {key}:')
        for code in codes:
            cid = course_map.get(code)
            if cid:
                assign_course(token, tid, cid, code)
            else:
                print(f'      ~ Curso {code} no encontrado')

    # ─── ESTUDIANTES DE PRUEBA (10) ───────────────────────────────────────────
    print('\n' + '=' * 60)
    print('CREACIÓN DE 10 ESTUDIANTES')
    print('=' * 60)

    students_seed = [
        ('jorge', 'jorge.gomez@ucc.edu.co', '123', 'Jorge Andres', 'Gomez Rios', '1067123456', 'Ingeniería de Sistemas'),
        ('maria', 'maria.lopez@ucc.edu.co', '123', 'Maria Fernanda', 'Lopez Ruiz', '1017654321', 'Derecho'),
        ('s1', 'laura.mejia@ucc.edu.co', '123', 'Laura Sofia', 'Mejia Castro', '1023456781', 'Administración de Empresas'),
        ('s2', 'felipe.suarez@ucc.edu.co', '123', 'Felipe Andres', 'Suarez Pinto', '1034567892', 'Ingeniería de Sistemas'),
        ('s3', 'valeria.romero@ucc.edu.co', '123', 'Valeria Isabel', 'Romero Diaz', '1045678903', 'Derecho'),
        ('s4', 'nicolas.marin@ucc.edu.co', '123', 'Nicolas David', 'Marin Torres', '1056789014', 'Administración de Empresas'),
        ('s5', 'camilo.rueda@ucc.edu.co', '123', 'Camilo Javier', 'Rueda Gomez', '1067890125', 'Ingeniería de Sistemas'),
        ('s6', 'daniela.arias@ucc.edu.co', '123', 'Daniela Maria', 'Arias Salas', '1078901236', 'Derecho'),
        ('s7', 'sebastian.pardo@ucc.edu.co', '123', 'Sebastian Jose', 'Pardo Luna', '1089012347', 'Administración de Empresas'),
        ('s8', 'paula.navarro@ucc.edu.co', '123', 'Paula Andrea', 'Navarro Vera', '1090123458', 'Ingeniería de Sistemas'),
    ]

    student_ids = {}
    for key, email, password, first_name, last_name, document_id, program in students_seed:
        sid = create_estudiante(token, email, password, first_name, last_name, document_id, program)
        student_ids[key] = sid

    jorge_id = student_ids.get('jorge')
    maria_id = student_ids.get('maria')

    # ─── MATRÍCULAS ───────────────────────────────────────────────────────────
    print('\n' + '=' * 60)
    print('MATRICULACIÓN DE ESTUDIANTES')
    print('=' * 60)

    matriculas = [
        (jorge_id, cc_isis, ['ISIS-101', 'ISIS-102', 'ISIS-103'], 'Jorge'),
        (maria_id, cc_der,  ['DER-101',  'DER-102',  'DER-107'],  'María'),
    ]
    for student_id, course_map, codes, nombre in matriculas:
        if not student_id:
            continue
        for code in codes:
            cid = course_map.get(code)
            if not cid:
                print(f'  ~ Curso {code} no encontrado')
                continue
            st, d = request('/enrollments', {
                'student_id': student_id,
                'course_id': cid,
                'status': 'activa',
            }, token=token)
            print(f'  {nombre} -> {code}: {st}')

    print('\n' + '=' * 60)
    print('✓ CREACIÓN COMPLETADA')
    print('=' * 60)
    print('\nResumen de credenciales docentes:')
    print('  Derecho:    carlos/patricia/andres/lucia/fernando/claudia/rodrigo @ucc.edu.co  | Derecho2026*')
    print('  Sistemas:   jaime/sandra/hector/diana/miguel/camila/ernesto @ucc.edu.co        | Sistemas2026*')
    print('  Admon:      rosa/tomas/isabel/alberto/valentina/guillermo @ucc.edu.co          | Admon2026*')
    print('  Estudiantes: 10 cuentas @ucc.edu.co (incluye jorge.gomez y maria.lopez) | contraseña: 123')

