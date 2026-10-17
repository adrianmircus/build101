import { LoginScreen } from "@/components/auth/LoginScreen";
import { loginTeacher } from "@/lib/auth/actions";

export default function TeacherLogin() {
  return (
    <LoginScreen
      role="teacher"
      title="Ingreso para profesores"
      subtitle="Entrá para ver tus grupos y preparar prácticos."
      action={loginTeacher}
    />
  );
}
