#include <qpdf/QPDF.hh>
#include <qpdf/QPDFWriter.hh>
#include <qpdf/BufferInputSource.hh>
#include <qpdf/Pl_Buffer.hh>
#include <iostream>
#include <stdexcept>
#include <qpdf/Pipeline.hh>
#include <iterator>
#include <string>
#include <sys/prctl.h>
#include <sys/resource.h>

// Bounded verification sink: retains no decoded stream payload.
class VerificationSink : public Pipeline {
 public:
  size_t count = 0;
  Pipeline* output;
  VerificationSink(Pipeline* destination = nullptr) : Pipeline("verify", destination), output(destination) {}
  void write(unsigned char const* data, size_t length) override {
    if (length > 32 * 1024 * 1024 - count) throw std::runtime_error("verification_limit");
    count += length;
    if (output) output->write(data, length);
  }
  void finish() override { if (output) output->finish(); }
};

// Memory-only PDF bridge. Neither document bytes nor native error details reach disk.
int main(int argc, char** argv) {
  const struct rlimit no_core = {0, 0};
  if (setrlimit(RLIMIT_CORE, &no_core) != 0 || prctl(PR_SET_DUMPABLE, 0) != 0) return 2;
  if (argc != 2) return 2;
  const std::string mode(argv[1]);
  if (mode != "to-json" && mode != "from-json" && mode != "verify") return 2;
  std::string input;
  char chunk[8192];
  while (std::cin.good()) {
    std::cin.read(chunk, sizeof(chunk));
    input.append(chunk, static_cast<size_t>(std::cin.gcount()));
    if (input.size() > (mode == "verify" ? 5 : 32) * 1024 * 1024) return 2;
  }
  try {
    QPDF pdf;
    pdf.setSuppressWarnings(true);
    if (mode == "verify") {
      pdf.processMemoryFile("memory", input.data(), input.size());
      VerificationSink sink;
      for (auto object : pdf.getAllObjects()) {
        if (object.isStream() && !object.pipeStreamData(&sink, nullptr, 0, qpdf_dl_generalized, false, false)) return 2;
      }
      Pl_Buffer output("json");
      VerificationSink bounded_output(&output);
      pdf.writeJSON(2, &bounded_output, qpdf_dl_generalized, qpdf_sj_none, "", {});
      bounded_output.finish();
      auto buffer = output.getBufferSharedPointer();
      if (buffer->getSize() > 32 * 1024 * 1024 || pdf.anyWarnings()) return 2;
      std::cout.write(reinterpret_cast<char const*>(buffer->getBuffer()), buffer->getSize());
    } else if (mode == "to-json") {
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
