import { checkAccessibility } from "./support/a11y";
import { expect, test } from "./support/fixtures";
import { qrAddress, studentWithCard } from "./support/panel";
import { expectNoProfileLabels } from "./support/student";
import { world } from "./support/world";

// Recorridos del login del estudiante (T2.6a, T2.10), de punta a punta: el admin crea el grupo y las cuentas en el panel, imprime las
// tarjetas, y el estudiante entra con lo que dice la tarjeta (que se lee de la hoja de impresión) o con el enlace del QR.
// Cada test arma su estudiante con un nombre que nadie más usa: corren en paralelo, en escritorio y en celular.

test.describe("login del estudiante", () => {
  test("primera vez: los tres datos de la tarjeta, el colegio queda recordado y entra a su inicio vacío", async ({ page }) => {
    const { institution } = world();
    const { card } = await studentWithCard(page);
    await page.goto("/ingresar/estudiante");
    await checkAccessibility(page, "estudiante-ingreso");
    await page.getByLabel("Código del colegio").fill(card.schoolCode);
    await expect(page.getByText(institution.name)).toBeVisible();
    await page.getByLabel("Usuario").fill(card.username);
    await page.getByLabel("Contraseña").fill(card.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/estudiante$/);
    await expect(page.getByRole("heading", { level: 1, name: "Tus prácticos" })).toBeVisible();
    await expect(page.getByText("Todavía no tenés prácticos.")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("tiza.school"))).toBe(JSON.stringify({ code: institution.code, name: institution.name }));
    await expectNoProfileLabels(page);
    await checkAccessibility(page, "estudiante-inicio-vacio");
    // The way out is on the page, and without a session the page goes back to the login.
    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page).toHaveURL(/\/ingresar\/estudiante/);
    await page.goto("/estudiante");
    await expect(page).toHaveURL(/\/ingresar\/estudiante/);
  });

  test("segunda vez: dos campos, con «Cambiar de colegio»", async ({ page }) => {
    const { institution } = world();
    await page.addInitScript((school) => localStorage.setItem("tiza.school", JSON.stringify(school)), { code: institution.code, name: institution.name });
    await page.goto("/ingresar/estudiante");
    await expect(page.getByText(institution.name)).toBeVisible();
    await expect(page.getByLabel("Código del colegio")).toHaveCount(0);
    await page.getByRole("button", { name: /Cambiar/ }).click();
    await expect(page.getByLabel("Código del colegio")).toBeVisible();
  });

  test("contraseña mal: aviso neutro con pista, y lo escrito sigue ahí", async ({ page }) => {
    const { card } = await studentWithCard(page);
    await page.goto("/ingresar/estudiante");
    await page.getByLabel("Código del colegio").fill(card.schoolCode);
    await page.getByLabel("Usuario").fill(card.username);
    await page.getByLabel("Contraseña").fill("nube tigre 47");
    await page.getByRole("button", { name: "Entrar" }).click();
    const aviso = page.getByRole("alert").filter({ hasText: "Probemos de nuevo" });
    await expect(aviso).toBeVisible();
    await expect(aviso).toBeFocused();
    await expect(page.getByLabel("Código del colegio")).toHaveValue(card.schoolCode);
    await expect(page.getByLabel("Usuario")).toHaveValue(card.username);
    await expect(page.getByLabel("Contraseña")).toHaveValue("nube tigre 47");
    await expectNoProfileLabels(page);
    await checkAccessibility(page, "estudiante-ingreso-error");
    // The next try, with the right one, goes in.
    await page.getByLabel("Contraseña").fill(card.password);
    await page.getByRole("button", { name: /Entrar|Probar de nuevo/ }).click();
    await expect(page).toHaveURL(/\/estudiante$/);
  });

  test("un colegio que no existe se dice por su nombre", async ({ page }) => {
    await page.goto("/ingresar/estudiante");
    await page.getByLabel("Código del colegio").fill("colegio-que-no-existe");
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toContainText("No encontramos el colegio colegio-que-no-existe");
  });

  test("muchos intentos: una pausa con la hora para volver", async ({ page }) => {
    const { card } = await studentWithCard(page);
    await page.goto("/ingresar/estudiante");
    await page.getByLabel("Código del colegio").fill(card.schoolCode);
    await page.getByLabel("Usuario").fill(card.username);
    const pause = page.getByRole("heading", { name: "Tomemos una pausa" });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await expect(page.getByRole("button", { name: /Entrar|Probar de nuevo/ })).toBeEnabled();
      const answered = page.waitForResponse((response) => response.request().method() === "POST");
      await page.getByLabel("Contraseña").fill(`mal-${attempt}`);
      await page.getByRole("button", { name: /Entrar|Probar de nuevo/ }).click();
      await answered;
      if (await pause.waitFor({ timeout: 2_000 }).then(() => true, () => false)) break;
    }
    await expect(pause).toBeVisible();
    await expect(page.locator("time")).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}T/);
  });

  test("/t#token: completa colegio y usuario, saca el token de la barra y pide solo la contraseña", async ({ page }) => {
    const { institution } = world();
    const { card, qrLink } = await studentWithCard(page);
    const token = new URL(qrLink).hash.slice(1);
    await page.goto(qrAddress(qrLink));
    await expect(page.getByText(institution.name)).toBeVisible();
    await expect(page.getByText(`Usuario ${card.username}`)).toBeVisible();
    expect(page.url()).not.toContain(token);
    await expect(page.getByLabel("Código del colegio")).toHaveCount(0);
    await expect(page.getByLabel("Contraseña")).toBeFocused();
    await checkAccessibility(page, "estudiante-tarjeta-qr");
    await page.getByLabel("Contraseña").fill(card.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/estudiante$/);
    await expect(page.getByText("Todavía no tenés prácticos.")).toBeVisible();
  });

  test("/t con una tarjeta que no sirve: aviso neutro y el login normal", async ({ page }) => {
    await page.goto(`/t#${"A".repeat(43)}`);
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toContainText("No pudimos usar esta tarjeta");
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
    const { card } = await studentWithCard(page);
    await page.goto("/ingresar/estudiante");
    await page.getByLabel("Código del colegio").focus();
    await page.keyboard.type(card.schoolCode);
    await page.keyboard.press("Tab");
    await page.keyboard.type(card.username);
    await page.keyboard.press("Tab");
    await page.keyboard.type(card.password);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/estudiante$/);
  });
});
