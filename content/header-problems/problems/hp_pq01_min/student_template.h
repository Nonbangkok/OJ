#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
const T &CP::priority_queue<T, Comp>::min() const
{
  // Your code here
  throw std::out_of_range("min() is not implemented yet");
}

#endif
