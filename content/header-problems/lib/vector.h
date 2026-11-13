#ifndef _CP_VECTOR_INCLUDED_
#define _CP_VECTOR_INCLUDED_

#include <iostream>
#include <stdexcept>

namespace CP
{

  template <typename T>
  class vector
  {
  public:
    typedef T *iterator;

  protected:
    T *mData;
    size_t mCap;
    size_t mSize;

    void rangeCheck(size_t index) const
    {
      if (index >= mSize)
      {
        throw std::out_of_range("index out of range");
      }
    }

    void expand(size_t capacity)
    {
      T *arr = new T[capacity]();
      for (size_t i = 0; i < mSize; i++)
      {
        arr[i] = mData[i];
      }
      delete[] mData;
      mData = arr;
      mCap = capacity;
    }

    void ensureCapacity(size_t capacity)
    {
      if (capacity > mCap)
      {
        size_t s = (capacity > 2 * mCap) ? capacity : 2 * mCap;
        expand(s);
      }
    }

  public:
    //-------------- constructor ----------

    // copy constructor
    vector(const vector<T> &a)
        : mData(new T[a.mCap]()), mCap(a.mCap), mSize(a.mSize)
    {
      for (size_t i = 0; i < a.mSize; i++)
      {
        mData[i] = a.mData[i];
      }
    }

    // default constructor
    vector() : mData(new T[1]()), mCap(1), mSize(0) {}

    // constructor with an initial size
    vector(size_t cap) : mData(new T[cap]()), mCap(cap), mSize(cap) {}

    // copy assignment operator, using the copy-and-swap idiom
    vector<T> &operator=(vector<T> other)
    {
      using std::swap;
      swap(mSize, other.mSize);
      swap(mCap, other.mCap);
      swap(mData, other.mData);
      return *this;
    }

    ~vector() { delete[] mData; }

    //------------- capacity function -------------------
    bool empty() const { return mSize == 0; }

    size_t size() const { return mSize; }

    size_t capacity() const { return mCap; }

    void resize(size_t n)
    {
      ensureCapacity(n);
      if (n > mSize)
      {
        T init = T();
        for (size_t i = mSize; i < n; i++)
          mData[i] = init;
      }
      mSize = n;
    }

    //----------------- iterator ---------------
    iterator begin() { return &mData[0]; }

    iterator end() { return begin() + mSize; }

    //----------------- access -----------------
    T &operator[](size_t index) { return mData[index]; }

    const T &operator[](size_t index) const { return mData[index]; }

    //----------------- modifier -------------
    void clear() { mSize = 0; }

    // for student.h
    // @@DECLARATIONS@@
  };

} // namespace CP

#endif
