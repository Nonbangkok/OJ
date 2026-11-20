import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;

/**
 * Trusted entry point of every judged Java run (compiled into the backend
 * image at /opt/oj/java-launcher, root-owned and read-only, first on the
 * classpath).
 *
 * It runs the student's class {@code Main} on a new thread named "main" with a
 * large stack, so beginner recursion does not overflow, while every other
 * thread keeps the default stack. A JVM-wide {@code -Xss} would give every
 * thread (the JVM's own Java threads included) a large stack, and each one
 * would count against RLIMIT_AS (spec 2026-11-20, decision 6).
 *
 * Semantics match the {@code java} launcher:
 * <ul>
 * <li>The entry point is chosen as the JDK 25 launcher does (JEP 512):
 *     {@code main(String[])} before {@code main()}. A static one is called
 *     directly; an instance one gets a new instance from the non-private
 *     no-argument constructor. This lets a compact source file
 *     ({@code void main() { ... }}) run too.</li>
 * <li>An uncaught exception prints {@code Exception in thread "main" } and the
 *     stack trace on stderr, then exits 1.</li>
 * <li>A normal return ends only the main thread. The JVM then exits 0 once
 *     the program's other non-daemon threads are done. {@code System.exit}
 *     passes through unchanged.</li>
 * </ul>
 * There is nothing to protect in here: the student's code runs in the same
 * JVM, and the sandbox around the whole process is the boundary.
 */
public final class OjJavaLauncher {
    /**
     * Stack of the student's main thread. Measured 2026-11-20 (JDK 25, JIT on):
     * a stack overflow costs far more than the stack, because the thread's
     * resource arena grows while the JVM unwinds, by up to ~6x the stack size
     * depending on JIT timing (64 MB peaked at 188 or 464 MB RSS; 256 MB near
     * 1 GB). 32 MB holds 200,000 frames of a simple recursion every time (often
     * 10^6), and its overflow peaked at ~116 MB. The worst case, a full 512 MB
     * heap plus an overflow plus the JVM, then stays inside what the backend
     * container's 1 GiB leaves next to Node. Raise this together with the
     * container's mem_limit.
     */
    private static final long MAIN_STACK_BYTES = 32L << 20;
    private static final String MAIN_CLASS = "Main";

    private static volatile Throwable failure;

    private OjJavaLauncher() {}

    public static void main(String[] args) throws InterruptedException {
        final Class<?> mainClass;
        try {
            // initialize=false: the static initializer runs on the big-stack
            // thread, at the first invocation.
            mainClass = Class.forName(MAIN_CLASS, false, OjJavaLauncher.class.getClassLoader());
        } catch (ClassNotFoundException | LinkageError e) {
            System.err.println("Error: Could not find or load main class " + MAIN_CLASS);
            System.err.println("Caused by: " + e);
            System.exit(1);
            return;
        }

        final Method entry = findEntryPoint(mainClass);
        if (entry == null) {
            System.err.println("Error: Main method not found in class " + MAIN_CLASS
                + ", please define the main method as:\n   public static void main(String[] args)\n"
                + "or a JavaFX application class must extend javafx.application.Application");
            System.exit(1);
            return;
        }

        Thread main = new Thread(null, () -> invoke(mainClass, entry, args), "main", MAIN_STACK_BYTES);
        main.start();
        main.join();

        Throwable thrown = failure;
        if (thrown != null) {
            System.err.print("Exception in thread \"main\" ");
            thrown.printStackTrace();
            System.exit(1);
        }
    }

    private static void invoke(Class<?> mainClass, Method entry, String[] args) {
        try {
            entry.setAccessible(true);
            Object target = null;
            if (!Modifier.isStatic(entry.getModifiers())) {
                Constructor<?> constructor = mainClass.getDeclaredConstructor();
                if (Modifier.isPrivate(constructor.getModifiers())) {
                    throw new NoSuchMethodException("Main has no non-private zero-argument constructor");
                }
                constructor.setAccessible(true);
                target = constructor.newInstance();
            }
            if (entry.getParameterCount() == 1) {
                entry.invoke(target, (Object) args);
            } else {
                entry.invoke(target);
            }
        } catch (InvocationTargetException e) {
            failure = e.getCause() != null ? e.getCause() : e;
        } catch (ExceptionInInitializerError e) {
            failure = e;
        } catch (Throwable e) {
            failure = e;
        }
    }

    /** {@code main(String[])} first, then {@code main()}; the class, then its superclasses. */
    private static Method findEntryPoint(Class<?> mainClass) {
        Method withArgs = findMain(mainClass, String[].class);
        return withArgs != null ? withArgs : findMain(mainClass);
    }

    private static Method findMain(Class<?> start, Class<?>... parameterTypes) {
        for (Class<?> c = start; c != null && c != Object.class; c = c.getSuperclass()) {
            try {
                Method m = c.getDeclaredMethod("main", parameterTypes);
                if (!Modifier.isPrivate(m.getModifiers()) && m.getReturnType() == void.class) {
                    return m;
                }
            } catch (NoSuchMethodException ignored) {
                // keep looking in the superclass
            }
        }
        return null;
    }
}
