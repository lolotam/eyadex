#include <qpdf/QPDF.hh>
#include <qpdf/QPDFWriter.hh>
#include <qpdf/BufferInputSource.hh>
#include <qpdf/Pl_Buffer.hh>
#include <iostream>
#include <iterator>
#include <string>
#include <sys/prctl.h>
#include <sys/resource.h>

// Disposable synthetic-data feasibility probe. No patient data is written to a filesystem.
int main(int argc, char** argv) {
  const struct rlimit no_core = {0, 0};
  if (setrlimit(RLIMIT_CORE, &no_core) != 0 || prctl(PR_SET_DUMPABLE, 0) != 0) return 2;
  if (argc != 2) return 2;
  const std::string mode(argv[1]);
  if (mode != "to-json" && mode != "from-json") return 2;
  std::string input;
  char chunk[8192];
  while (std::cin.good()) {
    std::cin.read(chunk, sizeof(chunk));
    input.append(chunk, static_cast<size_t>(std::cin.gcount()));
    if (input.size() > 32 * 1024 * 1024) return 2;
  }
  try {
    QPDF pdf;
    pdf.setSuppressWarnings(true);
    if (mode == "to-json") {
      pdf.processMemoryFile("memory", input.data(), input.size());
      Pl_Buffer output("json");
      pdf.writeJSON(2, &output, qpdf_dl_generalized, qpdf_sj_inline, "", {});
      output.finish();
      auto buffer = output.getBufferSharedPointer();
      if (buffer->getSize() > 32 * 1024 * 1024) return 2;
      if (pdf.anyWarnings()) return 2;
      std::cout.write(reinterpret_cast<char const*>(buffer->getBuffer()), buffer->getSize());
    } else {
      pdf.createFromJSON(std::make_shared<BufferInputSource>("memory", input));
      QPDFWriter writer(pdf);
      writer.setOutputMemory();
      // Compress the many small template objects without changing page drawing.
      writer.setObjectStreamMode(qpdf_o_generate);
      writer.write();
      auto buffer = writer.getBufferSharedPointer();
      if (buffer->getSize() > 5 * 1024 * 1024) return 2;
      if (pdf.anyWarnings()) return 2;
      std::cout.write(reinterpret_cast<char const*>(buffer->getBuffer()), buffer->getSize());
    }
    return std::cout.good() ? 0 : 2;
  } catch (...) {
    // Library exceptions may include document text. The parent receives only a fixed failure.
    std::cerr << "pdf_process_failed\n";
    return 2;
  }
}
