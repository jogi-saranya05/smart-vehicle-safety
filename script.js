document.addEventListener('DOMContentLoaded', () => {

  const navButtons = document.querySelectorAll('.nav-item');

  navButtons.forEach((button) => {

    button.addEventListener('click', () => {

      navButtons.forEach((btn) => btn.classList.remove('active'));

      button.classList.add('active');

    });

  });

});