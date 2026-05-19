// Generar estrellas dinámicamente
function generateStars() {
  const starsContainer = document.querySelector('.stars');
  if (!starsContainer) return;

  const starCount = 100;

  for (let i = 0; i < starCount; i++) {
    const star = document.createElement('div');
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const size = Math.random() * 2 + 1;
    const duration = Math.random() * 3 + 2;

    star.style.cssText = `
      position: absolute;
      left: ${x}%;
      top: ${y}%;
      width: ${size}px;
      height: ${size}px;
      background: white;
      border-radius: 50%;
      opacity: ${Math.random() * 0.7 + 0.3};
      animation: twinkle ${duration}s infinite;
      animation-delay: ${Math.random() * 2}s;
    `;

    starsContainer.appendChild(star);
  }
}

// Llamar al generar estrellas al cargar
document.addEventListener('DOMContentLoaded', generateStars);

// Manejar login
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const remember = document.querySelector('input[name="remember"]').checked;

    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: username,
          password: password,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        // Guardar token
        localStorage.setItem('token', data.access_token);
        if (remember) {
          localStorage.setItem('rememberMe', 'true');
          localStorage.setItem('username', username);
        }
        // Redirigir al dashboard
        window.location.href = '/dashboard';
      } else {
        alert('Login fallido. Verifique sus credenciales.');
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error al conectarse con el servidor.');
    }
  });
}
