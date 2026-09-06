# Force CMAKE_INSTALL_LIBDIR to "lib" (CMake 4.x defaults to "lib64" on 64-bit glibc)
# audiopus_sys hardcodes {install_dir}/lib for linking — this keeps cmake and the build.rs in sync.
set(CMAKE_INSTALL_LIBDIR "lib" CACHE STRING "lib directory" FORCE)
