import { checkAccessibility } from "./support/a11y";
import { expect, test } from "./support/fixtures";

// Recorridos del login del estudiante (T2.6a). Se activan en la tanda 4, cuando T2.5b trae los servicios de verdad:
// hoy responden UNAVAILABLE y no hay con qué entrar. Cada recorrido espera un colegio con el código `sanjose`
// y un estudiante `luciaf` con una tarjeta activa, que prepara el comando de administración (T2.2).
const SCHOOL = { code: "sanjose", name: "Colegio San José" };
const STUDENT = { username: "luciaf", password: "sol-nube-tigre-47" };

test.describe.skip("login del estudiante (se activa en la tanda 4)", () => {
  test("primera vez: los tres datos, el colegio queda recordado y entra", async ({ page }) => {
    await page.goto("/ingresar/estudiante");
    await checkAccessibility(page, "estudiante-ingreso");
    await page.getByLabel("Código del colegio").fill(SCHOOL.code);
    await expect(page.getByText(SCHOOL.name)).toBeVisible();
    await page.getByLabel("Usuario").fill(STUDENT.username);
    await page.getByLabel("Contraseña").fill(STUDENT.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/estudiante$/);
    expect(await page.evaluate(() => localStorage.getItem("tiza.school"))).toBe(JSON.stringify(SCHOOL));
  });

  test("segunda vez: dos campos, con «Cambiar de colegio»", async ({ page }) => {
    await page.addInitScript((school) => localStorage.setItem("tiza.school", JSON.stringify(school)), SCHOOL);
    await page.goto("/ingresar/estudiante");
    await expect(page.getByText(SCHOOL.name)).toBeVisible();
    await expect(page.getByLabel("Código del colegio")).toHaveCount(0);
    await page.getByRole("button", { name: /Cambiar/ }).click();
    await expect(page.getByLabel("Código del colegio")).toBeVisible();
  });

  test("contraseña mal: aviso neutro con pista, y lo escrito sigue ahí", async ({ page }) => {
    await page.goto("/ingresar/estudiante");
    await page.getByLabel("Código del colegio").fill(SCHOOL.code);
    await page.getByLabel("Usuario").fill(STUDENT.username);
    await page.getByLabel("Contraseña").fill("nube tigre 47");
    await page.getByRole("button", { name: "Entrar" }).click();
    const aviso = page.getByRole("alert");
    await expect(aviso).toContainText("Probemos de nuevo");
    await expect(aviso).toBeFocused();
    await expect(page.getByLabel("Usuario")).toHaveValue(STUDENT.username);
    await expect(page.getByLabel("Contraseña")).toHaveValue("nube tigre 47");
    await checkAccessibility(page, "estudiante-ingreso-error");
  });

  test("un colegio que no existe se dice por su nombre", async ({ page }) => {
    await page.goto("/ingresar/estudiante");
    await page.getByLabel("Código del colegio").fill("sanjos");
    await expect(page.getByRole("alert")).toContainText("No encontramos el colegio sanjos");
  });

  test("muchos intentos: una pausa con la hora para volver", async ({ page }) => {
    await page.goto("/ingresar/estudiante");
    await page.getByLabel("Código del colegio").fill(SCHOOL.code);
    await page.getByLabel("Usuario").fill(STUDENT.username);
    for (let i = 0; i < 11; i++) {
      await page.getByLabel("Contraseña").fill(`mal-${i}`);
      await page.getByRole("button", { name: /Entrar|Probar de nuevo/ }).click();
    }
    await expect(page.getByRole("heading", { name: "Tomemos una pausa" })).toBeVisible();
    await expect(page.locator("time")).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}T/);
  });

  test("/t#token: completa colegio y usuario, saca el token de la barra y pide la contraseña", async ({ page }) => {
    const token = process.env.E2E_CARD_TOKEN ?? "";
    await page.goto(`/t#${token}`);
    await expect(page.getByText(SCHOOL.name)).toBeVisible();
    await expect(page.getByText(`Usuario ${STUDENT.username}`)).toBeVisible();
    expect(page.url()).not.toContain(token);
    await expect(page.getByLabel("Contraseña")).toBeFocused();
    await page.getByLabel("Contraseña").fill(STUDENT.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/estudiante$/);
  });

  test("/t con una tarjeta que no sirve: aviso neutro y el login normal", async ({ page }) => {
    await page.goto(`/t#${"A".repeat(43)}`);
    await expect(page.getByRole("alert")).toContainText("No pudimos usar esta tarjeta");
    await expect(page.getByLabel("Código del colegio")).toBeVisible();
  });

  test("escanear sin BarcodeDetector: explica la cámara del celular y ofrece escribir", async ({ page }) => {
    await page.addInitScript(() => Reflect.deleteProperty(globalThis, "BarcodeDetector"));
    await page.goto("/ingresar/estudiante/escanear");
    await expect(page.getByText(/cámara de tu celular/)).toBeVisible();
    await page.getByRole("link", { name: "Escribir mis datos" }).click();
    await expect(page).toHaveURL(/\/ingresar\/estudiante$/);
  });

  test("con teclado: se puede entrar sin mouse", async ({ page }) => {
    await page.goto("/ingresar/estudiante");
    await page.getByLabel("Código del colegio").focus();
    await page.keyboard.type(SCHOOL.code);
    await page.keyboard.press("Tab");
    await page.keyboard.type(STUDENT.username);
    await page.keyboard.press("Tab");
    await page.keyboard.type(STUDENT.password);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/estudiante$/);
  });
});
