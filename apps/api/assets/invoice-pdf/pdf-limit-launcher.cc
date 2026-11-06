#include <sys/resource.h>
#include <unistd.h>

// Inherit zero soft/hard core limits in the API and every renderer child.
// A piped host collector remains a separate fail-closed runtime policy check.
int main(int argc, char** argv) {
  const struct rlimit no_core = {0, 0};
  if (argc < 2 || setrlimit(RLIMIT_CORE, &no_core) != 0) return 2;
  execv(argv[1], argv + 1);
  return 2;
}
