import { LoginScreen } from "@/components/auth/LoginScreen";
import { loginStudent } from "@/lib/auth/actions";

export default function StudentLogin() {
  return (
    <LoginScreen
      title="Ingreso para estudiantes"
      subtitle="Entrá con el usuario que te dio tu profesor."
      action={loginStudent}
      other={{ text: "¿Sos profesor? Entrá acá", href: "/login/teacher" }}
    />
  );
}
